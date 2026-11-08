import { createAdapter, ProviderError } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";
import {
  assertAssistantBudget,
  decryptCredentialForUse,
  getAssistantChat,
  getAssistantPreference,
  releaseAssistantUsage,
  reserveAssistantUsage,
  settleAssistantUsage,
  setAssistantChatSummary,
} from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { estimateSummaryTokens, HISTORY_MESSAGES, summarizeChat } from "@/lib/server/assistant";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Summary of a long chat (#280), only on the user's click – it costs one call on the workspace key with the chat's model
 * (or the default). Covers every message older than the last HISTORY_MESSAGES; later questions get it as data instead
 * of losing that part. The user's assistant limits are checked first and the call's tokens go into the usage ledger.
 */
export const POST = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`assistant:${actor.userId}`, 20, 60_000);
  const db = await getDb();
  const id = (await params).id;
  const { chat, messages } = await getAssistantChat(db, actor, id);
  const older = messages.filter((m) => !m.reviewOf).slice(0, -HISTORY_MESSAGES);
  const fresh = chat.summaryUntil ? older.filter((m) => m.createdAt > chat.summaryUntil!) : older;
  if (!fresh.length) throw new DomainError("CONFLICT", "Nothing to summarise yet – the chat still fits completely");
  const pref = await getAssistantPreference(db, actor);
  const credentialId = chat.credentialId ?? pref.credentialId;
  const modelId = chat.modelId ?? pref.modelId;
  if (!credentialId || !modelId) throw new DomainError("VALIDATION", "Choose a model from your AI providers");
  await assertAssistantBudget(db, actor);
  const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), credentialId);
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  // #519: the estimated tokens are reserved against the user's limits before the call.
  const reservation = await reserveAssistantUsage(db, actor, {
    kind: "summary",
    estimate: estimateSummaryTokens(fresh.reduce((n, m) => n + Math.min(m.content.length, 4_000), 0) + (chat.summary?.length ?? 0)),
  });
  let result: Awaited<ReturnType<typeof summarizeChat>>;
  try {
    result = await summarizeChat({
      adapter: createAdapter(provider, secret),
      model: modelId,
      messages: fresh.map((m) => ({ role: m.role, content: m.content })),
      previous: chat.summary,
      locale: isLocale(chosen) ? chosen : "en",
    });
  } catch (error) {
    await releaseAssistantUsage(db, actor, reservation);
    if (error instanceof ProviderError) throw new DomainError("PROVIDER_ERROR", `${provider}/${modelId}: ${error.message}`);
    throw error;
  }
  // The summary call costs tokens like an answer (ChatGPT review 08.11.26) – it counts toward the user's limits.
  await settleAssistantUsage(db, actor, reservation, result.usage);
  if (!result.summary) throw new DomainError("PROVIDER_ERROR", "The model returned no summary");
  const until = fresh.at(-1)!.createdAt;
  await setAssistantChatSummary(db, actor, id, result.summary, until);
  return NextResponse.json({ summary: result.summary, summaryUntil: until, covered: fresh.length, usage: result.usage, model: result.model }, { status: 201 });
});
