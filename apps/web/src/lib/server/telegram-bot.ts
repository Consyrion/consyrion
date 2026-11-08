import "server-only";
import { briefLanguage, createSession, reportLocale } from "@consyrion/council";
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
  type Database, recordClientCouncilStart
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
    help: 'Ask CONSYRION AI for a decision:\n/frage Should we use PostgreSQL or SQLite?\n- must cost under 20 € per month\n- backups without downtime\n\nLines starting with "- " are your hard requirements. /offen shows what is waiting for you.',
    summary: (q: string, reqs: string[], models: string[], budget = TELEGRAM_TOKEN_BUDGET) =>
      `Question: ${q}\nRequirements: ${reqs.length ? `\n- ${reqs.join("\n- ")}` : "none"}\nModels: ${models.join(", ")} (as in your last council)\nBudget: at most ${budget.toLocaleString("en-US")} tokens on your own keys; phases may be shortened to stay within it. A line "Budget: 150000" sets a lower ceiling.\n\nStart the council?`,
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
    help: 'Frag CONSYRION AI nach einer Entscheidung:\n/frage Sollen wir PostgreSQL oder SQLite nehmen?\n- muss unter 20 € pro Monat kosten\n- Backups ohne Ausfallzeit\n\nZeilen mit "- " sind deine festen Anforderungen. /offen zeigt, was auf dich wartet.',
    summary: (q: string, reqs: string[], models: string[], budget = TELEGRAM_TOKEN_BUDGET) =>
      `Frage: ${q}\nAnforderungen: ${reqs.length ? `\n- ${reqs.join("\n- ")}` : "keine"}\nModelle: ${models.join(", ")} (wie in deinem letzten Council)\nBudget: höchstens ${budget.toLocaleString("de-DE")} Tokens auf deinen eigenen Keys; Phasen können gekürzt werden, um es einzuhalten. Eine Zeile „Budget: 150000“ setzt eine niedrigere Obergrenze.\n\nCouncil starten?`,
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

/**
 * Night test R4 (08.11.26): an English question got a German summary, German status and a German PDF, because only the
 * language stored when the bot was switched on counted. The question's own language wins; the stored one is the
 * fallback when the text is too short to tell.
 */
export function questionLocale(text: string, fallback: string): string {
  return briefLanguage(text) ?? fallback;
}

/** Sentences that state a hard requirement although they do not start with "- " (night test R4: English "must" lines). */
const REQUIREMENT_WORDS =
  /\b(must|must not|shall|required|at least|at most|no more than|strictly|muss|müssen|darf|dürfen|mindestens|höchstens|maximal|nicht überschreiten|doit|ne doit pas|au moins|au plus|debe|no debe|como mínimo|como máximo)\b/i;

/**
 * Night test R4 (ChatGPT P2): "Budget: 180000" (or "budget 180k") on its own line sets the council's token ceiling;
 * without it the default applies. Kept between 50,000 and the default ceiling; the start still refuses a budget below
 * the team's minimum.
 */
export function parseBudget(text: string): number | null {
  const m = /^\s*(?:budget|token-?budget)\s*[:=]?\s*(\d[\d.,' ]*)\s*(k|tsd)?\s*(?:tokens?)?\s*$/im.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/[.,' ]/g, "")) * (m[2] ? 1_000 : 1);
  return Number.isFinite(n) ? Math.min(TELEGRAM_TOKEN_BUDGET, Math.max(50_000, Math.round(n))) : null;
}

/** "/frage Question\n- req\n- req" (or plain text) → question + the user's requirement lines. */
export function parseQuestion(text: string): { question: string; requirements: string[] } {
  const body = text.replace(/^\/(frage|ask|question)(@\w+)?\s*/i, "");
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !/^(?:budget|token-?budget)\b/i.test(l));
  const isReq = (l: string) => /^[-•*]\s+/.test(l);
  if (!lines.some(isReq)) {
    // No "- " lines: later lines that read like a requirement are proposed as requirements. The user still confirms
    // them with "Start", which shows the list first.
    const [first, ...rest] = lines.filter(Boolean);
    const reqs = rest.filter((l) => REQUIREMENT_WORDS.test(l) && !l.endsWith("?"));
    if (first && reqs.length)
      return {
        question: [first, ...rest.filter((l) => !reqs.includes(l))].join(" ").slice(0, 1_000),
        requirements: reqs.map((l) => l.slice(0, 500)).slice(0, 20),
      };
  }
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
    const [action, requestId, budgetText] = callback.data.split(":");
    const chosenBudget = budgetText ? Math.min(TELEGRAM_TOKEN_BUDGET, Math.max(50_000, Number(budgetText) || TELEGRAM_TOKEN_BUDGET)) : TELEGRAM_TOKEN_BUDGET;
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
      const request = await claimTelegramRequest(db, actor, requestId, inbound.connectionId, "cancelled");
      if (request) await edit(texts(questionLocale(request.question, inbound.locale)).cancelled);
      return { cancelled: true };
    }
    if (action === "go" && requestId) {
      const request = await claimTelegramRequest(db, actor, requestId, inbound.connectionId, "started");
      if (!request) return { duplicate: true };
      const t = texts(questionLocale(request.question, inbound.locale));
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
          { mode: "independent_expert", participants, tokenBudget: chosenBudget, confirmBudget: true },
          modelCatalog(db, actor),
        ).catch(async (error: unknown) => {
          // No project without a council (QA 07.11.26): a refused start archives the project it just created.
          await archiveProject(db, actor, project.id).catch(() => {});
          throw error;
        });
        await setTelegramRequestSession(db, request.id, session.id);
        // #429: a council started from Telegram counts against the daily client budget.
        await recordClientCouncilStart(db, actor, session.id, "telegram");
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
  const budget = parseBudget(text) ?? TELEGRAM_TOKEN_BUDGET;
  const tq = texts(questionLocale(text, inbound.locale));
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
  await send(tq.summary(question, requirements, models, budget), {
    reply_markup: {
      inline_keyboard: [
        [
          // The budget travels in the button the bot wrote into the private chat (no extra column).
          { text: tq.start, callback_data: budget === TELEGRAM_TOKEN_BUDGET ? `go:${request.id}` : `go:${request.id}:${budget}` },
          { text: tq.cancel, callback_data: `no:${request.id}` },
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
      // Verdict, summary and PDF in the connection's language (live test 08.11.26: German question, English PDF).
      // Night test R4: the question's own language first, then the connection's.
      const locale = questionLocale(request.question, (await deliveryConnectionForUse(db, actor, keyring, request.connectionId)).config.inboundLocale ?? "en");
      if (["awaiting_approval", "approved", "rejected"].includes(request.sessionStatus)) {
        const result = await deliverDecision(
          db,
          actor,
          keyring,
          request.sessionId!,
          { target: "telegram", connectionId: request.connectionId },
          { appUrl, fetch: fetchFn, locale: reportLocale(locale) },
        );
        await markTelegramRequest(db, request.id, result.status === "sent" ? "delivered" : "failed");
      } else {
        // Failed or cancelled council: a short note instead of a report.
        const connection = await deliveryConnectionForUse(db, actor, keyring, request.connectionId);
        const t = texts(locale);
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
