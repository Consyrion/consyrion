import { createAdapter, ProviderError } from "@consyrium/ai";
import { DomainError } from "@consyrium/core";
import {
  addAssistantCheck,
  assertAssistantBudget,
  decryptCredentialForUse,
  getAnswerForCheck,
  getAssistantChat,
  releaseAssistantUsage,
  reserveAssistantUsage,
  settleAssistantUsage,
} from "@consyrium/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isLocale, localeCookie } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { sameModelId } from "@/lib/council-check";
import { COUNCIL_CHAT_LIMITS, estimateCheckTokens, isSensitiveTopic, runCheck } from "@/lib/server/council-chat";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { onceAtATime } from "@/lib/server/in-flight";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string; messageId: string }> };

/**
 * Cross-check (#241 stage 2), only on the user's click: every OTHER model of the council chat judges one answer –
 * confirmed / contradicted / not checkable, with a reason. Body { participants: [{credentialId, modelId, label?}],
 * preview? }. preview: true → token estimate and the models that would check, without a model call. A model checks an
 * answer once; the answering model never checks itself. Every check goes into the usage ledger ("cross_check") and
 * counts toward the user's limits; the plan quota counts questions, not checks. Medicine, law, security and data
 * protection stay "not verified" however many models confirm.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const { id, messageId } = await params;
  const body = (await readJson(request).catch(() => ({}))) as { participants?: unknown; preview?: unknown };
  const participants = (Array.isArray(body.participants) ? body.participants : [])
    .filter((p): p is { credentialId: string; modelId: string; label?: string } => typeof p?.credentialId === "string" && typeof p?.modelId === "string")
    .slice(0, COUNCIL_CHAT_LIMITS.maxModels);
  const db = await getDb();
  const { question, answer, checkedBy } = await getAnswerForCheck(db, actor, id, messageId);
  const checkers = participants.filter(
    (p, i) =>
      !sameModelId(answer.model, p.modelId) &&
      !checkedBy.some((c) => sameModelId(c, p.modelId)) &&
      participants.findIndex((q) => sameModelId(q.modelId, p.modelId)) === i,
  );
  if (!checkers.length) throw new DomainError("VALIDATION", "No other model left to check this answer");

  // The other answers of the same turn (between this question and the next one) – context for the checkers.
  const { messages } = await getAssistantChat(db, actor, id);
  const index = messages.findIndex((m) => m.id === messageId);
  let start = index;
  while (start > 0 && messages[start - 1]!.role === "assistant") start--;
  let end = index;
  while (end + 1 < messages.length && messages[end + 1]!.role === "assistant") end++;
  const others = messages.slice(start, end + 1).filter((m) => m.id !== messageId && !m.reviewOf);
  const sensitive = isSensitiveTopic(question);

  if (body.preview === true) {
    const chars = question.length + answer.content.length + others.reduce((n, m) => n + Math.min(m.content.length, 4_000), 0);
    const perCheck = estimateCheckTokens(chars);
    return NextResponse.json({
      estimate: { tokens: perCheck * checkers.length, checks: checkers.length },
      checkers: checkers.map((p) => p.modelId),
      sensitive,
    });
  }

  return onceAtATime(`check:${actor.userId}:${messageId}`, async () => {
    rateLimit(`assistant:${actor.userId}`, 20, 60_000);
    await assertAssistantBudget(db, actor);
    const keys = new Map<string, { provider: Parameters<typeof createAdapter>[0]; secret: string }>();
    for (const p of checkers) if (!keys.has(p.credentialId)) keys.set(p.credentialId, await decryptCredentialForUse(db, actor, getKeyring(), p.credentialId));
    const chosen = localeCookie(await cookies());
    const locale = isLocale(chosen) ? chosen : "en";
    // #519: each check reserves its estimated tokens against the user's limits before any model runs.
    const perCheck = estimateCheckTokens(question.length + answer.content.length + others.reduce((n, m) => n + Math.min(m.content.length, 4_000), 0));
    const reservations: string[] = [];
    try {
      for (let i = 0; i < checkers.length; i++) reservations.push(await reserveAssistantUsage(db, actor, { kind: "cross_check", estimate: perCheck }));
    } catch (error) {
      for (const r of reservations) await releaseAssistantUsage(db, actor, r);
      throw error;
    }

    const results = await Promise.allSettled(
      checkers.map(async (p) => {
        const key = keys.get(p.credentialId)!;
        return runCheck({
          adapter: createAdapter(key.provider, key.secret),
          model: p.modelId,
          question,
          answer: { model: answer.model, content: answer.content },
          others: others.map((m) => ({ model: m.model, content: m.content })),
          locale,
          signal: request.signal,
        });
      }),
    );

    const checks = [];
    const failures: Array<{ model: string; error: string }> = [];
    for (const [i, outcome] of results.entries()) {
      if (outcome.status === "rejected") {
        await releaseAssistantUsage(db, actor, reservations[i]!);
        const error = outcome.reason;
        failures.push({ model: checkers[i]!.modelId, error: error instanceof ProviderError ? `${error.provider}: ${error.message}` : "failed" });
        continue;
      }
      const r = outcome.value;
      // Ledger first: the tokens count even if storing the check fails (e.g. a parallel duplicate).
      await settleAssistantUsage(db, actor, reservations[i]!, r.usage);
      try {
        checks.push(
          await addAssistantCheck(db, actor, id, {
            messageId,
            model: r.model,
            verdict: r.verdict,
            reason: r.reason,
            inputTokens: r.usage.inputTokens,
            outputTokens: r.usage.outputTokens,
          }),
        );
      } catch (error) {
        if (error instanceof DomainError && error.code === "CONFLICT") failures.push({ model: checkers[i]!.modelId, error: error.message });
        else throw error;
      }
    }
    if (!checks.length) throw new DomainError("PROVIDER_ERROR", failures.map((f) => `${f.model} – ${f.error}`).join("; ") || "No model checked the answer");
    return NextResponse.json({ checks, failures, sensitive }, { status: 201 });
  });
});
