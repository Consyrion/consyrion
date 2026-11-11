import { createAdapter, ProviderError } from "@consyrium/ai";
import { DomainError } from "@consyrium/core";
import {
  addAssistantMessage,
  assertAssistantBudget,
  assertEntitlement,
  createAssistantChat,
  decryptCredentialForUse,
  getAssistantChat,
  releaseAssistantUsage,
  reserveAssistantQuestion,
  reserveAssistantUsage,
  settleAssistantUsage,
} from "@consyrium/db";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { isLocale, localeCookie } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { assistantToolMode, estimateAnswerTokens, runAssistant } from "@/lib/server/assistant";
import { withCosts } from "@/lib/server/assistant-cost";
import { assistantTools } from "@/lib/server/assistant-tools";
import {
  addressedModel,
  COUNCIL_CHAT_LIMITS,
  councilEstimate,
  councilHistory,
  PERSPECTIVES,
  voiceInstruction,
  type Perspective,
} from "@/lib/server/council-chat";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Council chat turn (#241, stage 1/1b). Body { content, participants: [{credentialId, modelId, label?}], perspective?,
 * context?, preview? }.
 * - 2–4 participants: each model answers the question as its own voice (in parallel); "@model" at the start addresses
 *   one of them – only that one answers.
 * - 1 participant + perspective: one answer from that expert perspective, marked as a single, unverified perspective.
 * - preview: true → token estimate for the answers and for an optional cross-check, without any model call.
 * Every answer goes into the usage ledger; the plan quota counts the question once. Council-chat answers suggest no
 * actions (one voice per card would be confusing) – the 1-model chat keeps them.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as {
    content?: unknown;
    participants?: unknown;
    perspective?: unknown;
    context?: unknown;
    preview?: unknown;
  };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const participants = (Array.isArray(body.participants) ? body.participants : [])
    .filter((p): p is { credentialId: string; modelId: string; label?: string } => typeof p?.credentialId === "string" && typeof p?.modelId === "string")
    .slice(0, COUNCIL_CHAT_LIMITS.maxModels);
  const perspective = (PERSPECTIVES as readonly string[]).includes(String(body.perspective)) ? (body.perspective as Perspective) : null;
  if (perspective ? participants.length !== 1 : participants.length < COUNCIL_CHAT_LIMITS.minModels)
    throw new DomainError("VALIDATION", perspective ? "Choose one model for an expert perspective" : "Choose 2 to 4 models for the council chat");
  if (new Set(participants.map((p) => `${p.credentialId}|${p.modelId}`)).size !== participants.length)
    throw new DomainError("VALIDATION", "Choose each model only once");
  if (!content) throw new DomainError("VALIDATION", "Ask a question");
  if (content.length > 4_000) throw new DomainError("VALIDATION", "The question is too long (max. 4000 characters)");
  const db = await getDb();
  const id = (await params).id;
  const existing = id === "new" ? null : await getAssistantChat(db, actor, id);
  const history = existing ? councilHistory(existing.messages.filter((m) => !existing.chat.summaryUntil || m.createdAt > existing.chat.summaryUntil)) : [];
  const addressed = participants.length > 1 ? addressedModel(content, participants) : null;
  const answering = addressed ? participants.filter((p) => p.modelId === addressed) : participants;

  if (body.preview === true) {
    const estimate = councilEstimate({
      historyChars: history.reduce((n, m) => n + m.content.length, 0),
      questionChars: content.length,
      answering: answering.length,
      models: participants.length,
    });
    return NextResponse.json({ estimate, answering: answering.map((p) => p.modelId) });
  }

  rateLimit(`assistant:${actor.userId}`, 20, 60_000);
  await assertAssistantBudget(db, actor);
  await assertEntitlement(db, actor.organizationId, "assistant");
  // Keys checked before anything is stored (an unknown or foreign key is a 404).
  const keys = new Map<string, { provider: Parameters<typeof createAdapter>[0]; secret: string }>();
  for (const p of answering) if (!keys.has(p.credentialId)) keys.set(p.credentialId, await decryptCredentialForUse(db, actor, getKeyring(), p.credentialId));

  const context = body.context && typeof body.context === "object" ? (body.context as { kind?: unknown; id?: unknown; label?: unknown }) : null;
  const contextKind = typeof context?.kind === "string" ? context.kind.slice(0, 20) : null;
  const contextId = typeof context?.id === "string" ? context.id.slice(0, 60) : null;
  const chat =
    existing?.chat ??
    (await createAssistantChat(db, actor, {
      title: content,
      credentialId: participants[0]!.credentialId,
      modelId: participants[0]!.modelId,
      contextKind,
      contextId,
    }));
  // #510: one question of the plan's daily quota, reserved under a workspace lock before any model runs.
  // #519: every answering model reserves its estimated tokens; the first one also holds the question.
  const perAnswer = estimateAnswerTokens(
    history.reduce((n, m) => n + m.content.length, 0),
    content.length,
  );
  const reservations: string[] = [await reserveAssistantQuestion(db, actor, perAnswer)];
  try {
    for (let i = 1; i < answering.length; i++) reservations.push(await reserveAssistantUsage(db, actor, { kind: "council_answer", estimate: perAnswer }));
  } catch (error) {
    for (const r of reservations) await releaseAssistantUsage(db, actor, r);
    throw error;
  }
  await addAssistantMessage(db, actor, chat.id, { role: "user", content });

  const chosen = localeCookie(await cookies());
  const decisionSection = (await getTranslations("verdictScreen"))("form.title");
  const names = participants.map((p) => p.label || p.modelId);
  const results = await Promise.allSettled(
    answering.map(async (p) => {
      const key = keys.get(p.credentialId)!;
      const result = await runAssistant({
        adapter: createAdapter(key.provider, key.secret),
        model: p.modelId,
        history,
        question: content,
        locale: isLocale(chosen) ? chosen : "en",
        context: contextKind && contextId ? `${contextKind} ${contextId}${typeof context?.label === "string" ? ` (${context.label.slice(0, 80)})` : ""}` : null,
        tools: assistantTools(db, actor),
        decisionSection,
        signal: request.signal,
        mode: assistantToolMode(),
        summary: existing?.chat.summary ?? null,
        voice: voiceInstruction({ model: p.label || p.modelId, others: names.filter((n) => n !== (p.label || p.modelId)), perspective }),
      });
      return { p, result };
    }),
  );

  const messages = [];
  const failures: Array<{ model: string; error: string }> = [];
  let counted = false;
  let settledExtra = 1;
  for (const [i, outcome] of results.entries()) {
    if (outcome.status === "rejected") {
      const error = outcome.reason;
      failures.push({ model: answering[i]!.modelId, error: error instanceof ProviderError ? `${error.provider}: ${error.message}` : "failed" });
      continue;
    }
    const { result } = outcome.value;
    // The plan quota counts the question once: the first answer settles the question's reservation, the others theirs.
    await settleAssistantUsage(db, actor, reservations[counted ? settledExtra++ : 0]!, result.usage);
    counted = true;
    messages.push(
      await addAssistantMessage(db, actor, chat.id, {
        role: "assistant",
        content: result.answer,
        model: result.model,
        // A marker the panel shows as "Single perspective – unverified" (#241 stage 1b); not a tool call.
        tools: [...result.tools, ...(perspective ? [{ name: "_perspective", args: { role: perspective } }] : [])],
        links: result.links,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }),
    );
  }
  // Reservations of models that did not answer are given back (all of them when nobody answered).
  for (const r of reservations.slice(messages.length ? settledExtra : 0)) await releaseAssistantUsage(db, actor, r);
  if (!messages.length) throw new DomainError("PROVIDER_ERROR", failures.map((f) => `${f.model} – ${f.error}`).join("; ") || "No model answered");
  return NextResponse.json({ chatId: chat.id, title: chat.title, messages: await withCosts(db, actor, messages), failures }, { status: 201 });
});
