import { createAdapter, ProviderError } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";
import {
  addAssistantMessage,
  assertAssistantBudget,
  decryptCredentialForUse,
  getAnswerForReview,
  getAssistantPreference,
  releaseAssistantUsage,
  reserveAssistantUsage,
  settleAssistantUsage,
} from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { assistantToolMode, estimateAnswerTokens, reviewQuestion, runAssistant } from "@/lib/server/assistant";
import { withCosts } from "@/lib/server/assistant-cost";
import { assistantTools } from "@/lib/server/assistant-tools";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { onceAtATime } from "@/lib/server/in-flight";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string; messageId: string }> };

/**
 * Second opinion (#281): another model checks one answer of the user's own chat against the workspace data (same
 * read-only tools) and says whether it is right and complete. Body { credentialId?, modelId? } – default: the reviewer
 * model of the user's assistant settings. Costs tokens on the workspace key; the user's assistant limits apply. Stored
 * as an answer with `reviewOf`; it suggests no actions. One second opinion per answer.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`assistant:${actor.userId}`, 20, 60_000);
  const { id, messageId } = await params;
  const body = (await readJson(request).catch(() => ({}))) as { credentialId?: unknown; modelId?: unknown };
  const db = await getDb();
  const pref = await getAssistantPreference(db, actor);
  const credentialId = typeof body.credentialId === "string" ? body.credentialId : pref.reviewerCredentialId;
  const modelId = (typeof body.modelId === "string" ? body.modelId : pref.reviewerModelId)?.trim();
  if (!credentialId || !modelId) throw new DomainError("VALIDATION", "Choose a model for second opinions in the assistant settings");
  return onceAtATime(`review:${actor.userId}:${messageId}`, async () => {
    const { question, answer } = await getAnswerForReview(db, actor, id, messageId);
    await assertAssistantBudget(db, actor);
    const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), credentialId);
    const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
    const prompt = reviewQuestion(question, answer.content, answer.model);
    // #519: the estimated tokens are reserved against the user's limits before the call.
    const reservation = await reserveAssistantUsage(db, actor, { kind: "second_opinion", estimate: estimateAnswerTokens(0, prompt.length) });
    let result: Awaited<ReturnType<typeof runAssistant>>;
    try {
      result = await runAssistant({
        adapter: createAdapter(provider, secret),
        model: modelId,
        history: [],
        question: prompt,
        locale: isLocale(chosen) ? chosen : "en",
        context: null,
        tools: assistantTools(db, actor),
        signal: request.signal,
        mode: assistantToolMode(),
      });
    } catch (error) {
      await releaseAssistantUsage(db, actor, reservation);
      if (error instanceof ProviderError) throw new DomainError("PROVIDER_ERROR", `${provider}/${modelId}: ${error.message}`);
      throw error;
    }
    // Usage ledger first (ChatGPT review 08.11.26): counts toward the limits even if the chat is deleted later.
    await settleAssistantUsage(db, actor, reservation, result.usage);
    const message = await addAssistantMessage(db, actor, id, {
      role: "assistant",
      content: result.answer,
      model: result.model,
      tools: result.tools,
      links: result.links,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reviewOf: answer.id,
    });
    const [priced] = await withCosts(db, actor, [message]);
    return NextResponse.json({ message: priced }, { status: 201 });
  });
});
