import { createAdapter, ProviderError } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";
import {
  acceptActionProposals,
  addAssistantMessage,
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
import { runAssistant, type AssistantEvent } from "@/lib/server/assistant";
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
  if (typeof body.credentialId !== "string" || typeof body.modelId !== "string" || !body.modelId.trim())
    throw new DomainError("VALIDATION", "Choose a model from your AI providers");
  const context = body.context && typeof body.context === "object" ? (body.context as { kind?: unknown; id?: unknown; label?: unknown }) : null;
  const contextKind = typeof context?.kind === "string" ? context.kind.slice(0, 20) : null;
  const contextId = typeof context?.id === "string" ? context.id.slice(0, 60) : null;
  const db = await getDb();

  // Check the key first: an unknown or foreign credential is a clear 404, not a broken chat row (500 before 06.11.26).
  const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), body.credentialId);
  const id = (await params).id;
  const chat =
    id === "new"
      ? await createAssistantChat(db, actor, { title: content, credentialId: body.credentialId, modelId: body.modelId, contextKind, contextId })
      : (await getAssistantChat(db, actor, id)).chat;
  if (id !== "new" && (chat.credentialId !== body.credentialId || chat.modelId !== body.modelId))
    await setAssistantChatModel(db, actor, chat.id, body.credentialId, body.modelId);
  const history = id === "new" ? [] : (await getAssistantChat(db, actor, chat.id)).messages.map((m) => ({ role: m.role, content: m.content }));
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
        onEvent,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw new DomainError("PROVIDER_ERROR", `${provider}/${modelId}: ${error.message}`);
      throw error;
    }
    const { actions } = acceptActionProposals(result.actions);
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
    return { chatId: chat.id, title: chat.title, message };
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
