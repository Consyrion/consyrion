import { createAdapter, ProviderError } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";
import {
  acceptActionProposals,
  addAssistantMessage,
  releaseAssistantQuestion,
  reserveAssistantQuestion,
  settleAssistantQuestion,
  assertAssistantBudget,
  assertEntitlement,
  getAssistantPreference,
  createAssistantChat,
  decryptCredentialForUse,
  getAssistantChat,
  setAssistantChatModel,
} from "@consyrion/db";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { assistantToolMode, estimateAnswerTokens, runAssistant, type AssistantEvent } from "@/lib/server/assistant";
import { withCosts } from "@/lib/server/assistant-cost";
import { assistantTools } from "@/lib/server/assistant-tools";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Ask the assistant (#278): `id` = an existing chat or "new". Body { content, credentialId, modelId, context? }.
 * With `Accept: text/event-stream` the answer streams as Server-Sent Events (#284); otherwise one JSON response.
 * One question = up to a few calls on the workspace's own key (BYOK); the answer, the tools it used and the tokens are
 * stored with the chat. Read-only: the tools cannot change anything. Suggested actions (#283) are checked against the
 * allowlist and stored as cards; they run only through the actions route, on the user's click.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`assistant:${actor.userId}`, 20, 60_000);
  const body = (await readJson(request)) as { content?: unknown; credentialId?: unknown; modelId?: unknown; context?: unknown };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) throw new DomainError("VALIDATION", "Ask a question");
  if (content.length > 4_000) throw new DomainError("VALIDATION", "The question is too long (max. 4000 characters)");
  const db = await getDb();
  // #281: without a model in the request the user's default model from the assistant settings answers.
  if (typeof body.credentialId !== "string" || typeof body.modelId !== "string" || !body.modelId.trim()) {
    const pref = await getAssistantPreference(db, actor);
    if (pref.credentialId && pref.modelId) [body.credentialId, body.modelId] = [pref.credentialId, pref.modelId];
  }
  if (typeof body.credentialId !== "string" || typeof body.modelId !== "string" || !body.modelId.trim())
    throw new DomainError("VALIDATION", "Choose a model from your AI providers");
  // The user's own daily/monthly assistant limits (#281), checked before anything is stored or called.
  await assertAssistantBudget(db, actor);
  // The plan's daily question limit for the workspace (#281), set by the platform admin.
  await assertEntitlement(db, actor.organizationId, "assistant");
  const context = body.context && typeof body.context === "object" ? (body.context as { kind?: unknown; id?: unknown; label?: unknown }) : null;
  const contextKind = typeof context?.kind === "string" ? context.kind.slice(0, 20) : null;
  const contextId = typeof context?.id === "string" ? context.id.slice(0, 60) : null;

  // Check the key first: an unknown or foreign credential is a clear 404, not a broken chat row (500 before 06.11.26).
  const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), body.credentialId);
  const id = (await params).id;
  const chat =
    id === "new"
      ? await createAssistantChat(db, actor, { title: content, credentialId: body.credentialId, modelId: body.modelId, contextKind, contextId })
      : (await getAssistantChat(db, actor, id)).chat;
  if (id !== "new" && (chat.credentialId !== body.credentialId || chat.modelId !== body.modelId))
    await setAssistantChatModel(db, actor, chat.id, body.credentialId, body.modelId);
  // #280: with a stored summary, the messages it covers are passed as that summary; second opinions stay out of the history.
  // #241 stage 3: after a council chat (answers of several models) each answer keeps its model label, so a follow-up
  // like "make it a council" knows who said what.
  const earlier =
    id === "new"
      ? []
      : (await getAssistantChat(db, actor, chat.id)).messages.filter((m) => !m.reviewOf && (!chat.summaryUntil || m.createdAt > chat.summaryUntil));
  const several = new Set(earlier.filter((m) => m.role === "assistant" && m.model).map((m) => m.model)).size > 1;
  const history = earlier.map((m) => ({ role: m.role, content: several && m.role === "assistant" && m.model ? `[${m.model}] ${m.content}` : m.content }));
  // #510: the plan's daily question is reserved under a workspace lock before the model runs (parallel requests).
  const reservation = await reserveAssistantQuestion(
    db,
    actor,
    estimateAnswerTokens(
      history.reduce((n, m) => n + m.content.length, 0),
      content.length,
    ),
  );
  await addAssistantMessage(db, actor, chat.id, { role: "user", content });

  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  // The decision form's heading as the user sees it ("Deine Entscheidung", "Your decision", …) – ChatGPT QA 06.11.26.
  const decisionSection = (await getTranslations("verdictScreen"))("form.title");
  const modelId = body.modelId.trim();
  const ask = async (onEvent?: (event: AssistantEvent) => void) => {
    let result: Awaited<ReturnType<typeof runAssistant>>;
    try {
      result = await runAssistant({
        adapter: createAdapter(provider, secret),
        model: modelId,
        history,
        question: content,
        locale: isLocale(chosen) ? chosen : "en",
        context: contextKind && contextId ? `${contextKind} ${contextId}${typeof context?.label === "string" ? ` (${context.label.slice(0, 80)})` : ""}` : null,
        tools: assistantTools(db, actor),
        decisionSection,
        signal: request.signal,
        mode: assistantToolMode(),
        summary: id === "new" ? null : chat.summary,
        onEvent,
      });
    } catch (error) {
      // No answer, no question used (#510): the reservation is given back.
      await releaseAssistantQuestion(db, actor, reservation);
      if (error instanceof ProviderError) throw new DomainError("PROVIDER_ERROR", `${provider}/${modelId}: ${error.message}`);
      throw error;
    }
    const { actions, rejected } = acceptActionProposals(result.actions);
    // Dropped suggestions are logged by type and reason only (no content), so silent losses become visible (live test 08.11.26).
    if (rejected.length) console.warn("[assistant] action suggestions dropped", JSON.stringify(rejected));
    // Usage ledger first (ChatGPT review 08.11.26): counts toward the limits even if the chat is deleted later.
    await settleAssistantQuestion(db, actor, reservation, result.usage);
    const message = await addAssistantMessage(db, actor, chat.id, {
      role: "assistant",
      content: result.answer,
      actions,
      model: result.model,
      tools: result.tools,
      links: result.links,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    const [priced] = await withCosts(db, actor, [message]);
    return { chatId: chat.id, title: chat.title, message: priced! };
  };

  if (!request.headers.get("accept")?.includes("text/event-stream")) return NextResponse.json(await ask());

  // Streaming (#284): Server-Sent Events – "delta"/"reset"/"tool" while the model writes, then "done" with the stored
  // message (the same body as the JSON answer) or "error". A closed tab aborts request.signal and with it the provider call.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: Record<string, unknown>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        send({ type: "done", ...(await ask(send)) });
      } catch (error) {
        const cancelled = error instanceof ProviderError && error.kind === "cancelled";
        if (!cancelled) send({ type: "error", message: error instanceof DomainError ? error.message : "Unexpected server error" });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: Next's compression and proxies must not buffer the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
