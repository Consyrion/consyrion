import "server-only";
import { createSession } from "@consyrion/council";
import { DomainError, type Keyring } from "@consyrion/core";
import {
  archiveProject,
  assertEntitlement,
  claimTelegramRequest,
  createProjectForDecisionRequest,
  createTelegramRequest,
  deliveryConnectionForUse,
  finishedTelegramRequests,
  lastCouncilParticipants,
  markTelegramRequest,
  resolveActor,
  setTelegramRequestSession,
  type ActorContext,
  type Database,
} from "@consyrion/db";
import { assistantTools } from "./assistant-tools";
import { deliverDecision } from "./delivery";
import { modelCatalog } from "./model-catalog";

/**
 * Questions over the workspace's own Telegram bot (06.11.26): "/frage …" (or any text) → a summary with the models
 * of the last council and the budget → the user taps "Start" → ask_consyrion's flow (project, requirement list from the
 * user's own "- " lines, council) → when the council is done, the verdict goes back to the chat (summary + PDF).
 * Only the private chat of the connection is listened to; nothing runs without the tap.
 */

export const TELEGRAM_TOKEN_BUDGET = 300_000;
type Fetch = typeof fetch;

export interface Inbound {
  connectionId: string;
  organizationId: string;
  userId: string;
  chatId: string;
  locale: string;
  botToken: string;
}

const TEXT = {
  en: {
    help: 'Ask CONSYRION AI for a decision:\n/frage Should we use PostgreSQL or SQLite?\n- must cost under 20 €/month\n- backups without downtime\n\nLines starting with "- " are your hard requirements. /offen shows what is waiting for you.',
    summary: (q: string, reqs: string[], models: string[]) =>
      `Question: ${q}\nRequirements: ${reqs.length ? `\n- ${reqs.join("\n- ")}` : "none"}\nModels: ${models.join(", ")} (as in your last council)\nBudget: at most ${TELEGRAM_TOKEN_BUDGET.toLocaleString("en-US")} tokens on your own keys; phases may be shortened to stay within it.\n\nStart the council?`,
    start: "▶ Start",
    cancel: "✕ Cancel",
    started: (url: string) => `Council started. I'll send the verdict here when it is done (a few minutes).\n${url}`,
    cancelled: "Cancelled – nothing was started.",
    noModels: "No earlier council to take the models from. Start one council in the app first, then ask here.",
    pro: "Questions over Telegram are part of Pro. Upgrade under Settings → Billing.",
    failed: (msg: string) => `Could not start: ${msg}`,
    councilFailed: (url: string) => `The council did not finish (failed or cancelled). Details: ${url}`,
    open: (lines: string[], total: number) =>
      lines.length ? `Waiting for you (${lines.length} of ${total}):\n${lines.join("\n")}` : "Nothing is waiting for you.",
  },
  de: {
    help: 'Frag CONSYRION AI nach einer Entscheidung:\n/frage Sollen wir PostgreSQL oder SQLite nehmen?\n- muss unter 20 €/Monat kosten\n- Backups ohne Ausfallzeit\n\nZeilen mit "- " sind deine festen Anforderungen. /offen zeigt, was auf dich wartet.',
    summary: (q: string, reqs: string[], models: string[]) =>
      `Frage: ${q}\nAnforderungen: ${reqs.length ? `\n- ${reqs.join("\n- ")}` : "keine"}\nModelle: ${models.join(", ")} (wie in deinem letzten Council)\nBudget: höchstens ${TELEGRAM_TOKEN_BUDGET.toLocaleString("de-DE")} Tokens auf deinen eigenen Keys; Phasen können gekürzt werden, um es einzuhalten.\n\nCouncil starten?`,
    start: "▶ Starten",
    cancel: "✕ Abbrechen",
    started: (url: string) => `Council gestartet. Sobald er fertig ist (wenige Minuten), schicke ich das Urteil hierher.\n${url}`,
    cancelled: "Abgebrochen – es wurde nichts gestartet.",
    noModels: "Es gibt noch keinen Council, dessen Modelle ich übernehmen kann. Starte zuerst einen Council in der App, dann frag hier.",
    pro: "Fragen per Telegram sind im Pro-Plan enthalten. Upgrade unter Einstellungen → Abrechnung.",
    failed: (msg: string) => `Konnte nicht starten: ${msg}`,
    councilFailed: (url: string) => `Der Council ist nicht fertig geworden (fehlgeschlagen oder abgebrochen). Details: ${url}`,
    open: (lines: string[], total: number) =>
      lines.length ? `Wartet auf dich (${lines.length} von ${total}):\n${lines.join("\n")}` : "Nichts wartet auf dich.",
  },
};
const texts = (locale: string) => (locale === "de" ? TEXT.de : TEXT.en);

/** "/frage Question\n- req\n- req" (or plain text) → question + the user's requirement lines. */
export function parseQuestion(text: string): { question: string; requirements: string[] } {
  const body = text.replace(/^\/(frage|ask|question)(@\w+)?\s*/i, "");
  const lines = body.split("\n").map((l) => l.trim());
  const isReq = (l: string) => /^[-•*]\s+/.test(l);
  return {
    question: lines
      .filter((l) => l && !isReq(l))
      .join(" ")
      .slice(0, 1_000),
    requirements: lines
      .filter(isReq)
      .map((l) => l.replace(/^[-•*]\s+/, "").slice(0, 500))
      .slice(0, 20),
  };
}

export async function telegramCall(fetchFn: Fetch, botToken: string, method: string, body: Record<string, unknown>) {
  const response = await fetchFn(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description ?? response.status}`);
  return data;
}

interface Update {
  message?: { chat?: { id?: number; type?: string }; from?: { id?: number }; text?: string };
  callback_query?: { id?: string; from?: { id?: number }; data?: string; message?: { chat?: { id?: number }; message_id?: number } };
}

/** One webhook update. Ignores everything that is not from the connection's private chat. */
export async function handleTelegramUpdate(update: Update, deps: { db: Database; keyring: Keyring; inbound: Inbound; fetch?: Fetch; appUrl: string }) {
  const { db, inbound } = deps;
  const fetchFn = deps.fetch ?? fetch;
  const t = texts(inbound.locale);
  const send = (text: string, extra: Record<string, unknown> = {}) =>
    telegramCall(fetchFn, inbound.botToken, "sendMessage", { chat_id: inbound.chatId, text, link_preview_options: { is_disabled: true }, ...extra });

  const fromChat = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  const fromUser = update.message?.from?.id ?? update.callback_query?.from?.id;
  if (String(fromChat) !== inbound.chatId || String(fromUser) !== inbound.chatId) return { ignored: true };

  let actor: ActorContext;
  try {
    actor = await resolveActor(db, inbound.userId, inbound.organizationId);
    await assertEntitlement(db, inbound.organizationId, "mcp");
  } catch (error) {
    await send(error instanceof DomainError && error.code === "FORBIDDEN" ? t.pro : t.failed("no access to the workspace"));
    return { refused: true };
  }

  const callback = update.callback_query;
  if (callback?.data && callback.id) {
    await telegramCall(fetchFn, inbound.botToken, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => undefined);
    const [action, requestId] = callback.data.split(":");
    const messageId = callback.message?.message_id;
    const edit = (text: string) =>
      messageId
        ? telegramCall(fetchFn, inbound.botToken, "editMessageText", {
            chat_id: inbound.chatId,
            message_id: messageId,
            text,
            link_preview_options: { is_disabled: true },
          }).catch(() => send(text))
        : send(text);
    if (action === "no" && requestId) {
      if (await claimTelegramRequest(db, actor, requestId, inbound.connectionId, "cancelled")) await edit(t.cancelled);
      return { cancelled: true };
    }
    if (action === "go" && requestId) {
      const request = await claimTelegramRequest(db, actor, requestId, inbound.connectionId, "started");
      if (!request) return { duplicate: true };
      try {
        const participants = (await lastCouncilParticipants(db, actor)).map((p) => ({ credentialId: p.credentialId, modelId: p.modelId }));
        if (participants.length < 2) throw new DomainError("VALIDATION", t.noModels);
        const { project } = await createProjectForDecisionRequest(
          db,
          actor,
          { question: request.question, context: `Asked over Telegram: ${request.question}`, options: [], requirements: request.requirements },
          "telegram",
        );
        const session = await createSession(
          db,
          actor,
          project.id,
          // The tap on "Start" accepted the budget text, which says phases may be shortened (#148).
          { mode: "independent_expert", participants, tokenBudget: TELEGRAM_TOKEN_BUDGET, confirmBudget: true },
          modelCatalog(db, actor),
        ).catch(async (error: unknown) => {
          // No project without a council (QA 07.11.26): a refused start archives the project it just created.
          await archiveProject(db, actor, project.id).catch(() => {});
          throw error;
        });
        await setTelegramRequestSession(db, request.id, session.id);
        await edit(t.started(`${deps.appUrl}/sessions/${session.id}`));
        return { started: session.id };
      } catch (error) {
        await setTelegramRequestSession(db, request.id, null, "failed");
        await edit(t.failed(error instanceof DomainError ? error.message : "unexpected error"));
        return { failed: true };
      }
    }
    return { ignored: true };
  }

  const text = update.message?.text?.trim() ?? "";
  if (!text || /^\/(start|help|hilfe)\b/i.test(text)) {
    await send(t.help);
    return { help: true };
  }
  if (/^\/offen\b|^\/open\b/i.test(text)) {
    const tool = assistantTools(db, actor).find((x) => x.name === "list_open_steps")!;
    const { data } = await tool.run({});
    const steps = (data as { total: number; steps: Array<{ project: string; status: string; href: string }> }).steps.slice(0, 10);
    await send(
      t.open(
        steps.map((s) => `- ${s.project}: ${deps.appUrl}${s.href}`),
        (data as { total: number }).total,
      ),
    );
    return { open: true };
  }
  const { question, requirements } = parseQuestion(text);
  if (question.length < 5) {
    await send(t.help);
    return { help: true };
  }
  const models = (await lastCouncilParticipants(db, actor)).map((p) => p.modelId);
  if (models.length < 2) {
    await send(t.noModels);
    return { noModels: true };
  }
  const request = await createTelegramRequest(db, actor, { connectionId: inbound.connectionId, question, requirements });
  await send(t.summary(question, requirements, models), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: t.start, callback_data: `go:${request.id}` },
          { text: t.cancel, callback_data: `no:${request.id}` },
        ],
      ],
    },
  });
  return { pending: request.id };
}

/** Sends finished verdicts back to the chats they were asked from. Runs every 30 s in the web process. */
export async function telegramNotifierTick(db: Database, keyring: Keyring, appUrl: string, fetchFn: Fetch = fetch) {
  for (const request of await finishedTelegramRequests(db)) {
    try {
      const actor = await resolveActor(db, request.userId, request.organizationId);
      if (["awaiting_approval", "approved", "rejected"].includes(request.sessionStatus)) {
        const result = await deliverDecision(
          db,
          actor,
          keyring,
          request.sessionId!,
          { target: "telegram", connectionId: request.connectionId },
          { appUrl, fetch: fetchFn },
        );
        await markTelegramRequest(db, request.id, result.status === "sent" ? "delivered" : "failed");
      } else {
        // Failed or cancelled council: a short note instead of a report.
        const connection = await deliveryConnectionForUse(db, actor, keyring, request.connectionId);
        const t = texts(connection.config.inboundLocale ?? "en");
        await telegramCall(fetchFn, connection.secret, "sendMessage", {
          chat_id: connection.config.chatId,
          text: t.councilFailed(`${appUrl}/sessions/${request.sessionId}`),
        });
        await markTelegramRequest(db, request.id, "delivered");
      }
    } catch {
      await markTelegramRequest(db, request.id, "failed");
    }
  }
}
