import { randomBytes } from "node:crypto";
import { DomainError } from "@consyrion/core";
import { assertEntitlement, disableTelegramInbound, enableTelegramInbound } from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, localeFromAcceptLanguage } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";
import { telegramCall } from "@/lib/server/telegram-bot";

type Params = { params: Promise<{ id: string }> };

const appUrl = () => (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");

/**
 * Switches "questions over Telegram" on for a Telegram connection (Pro): registers the webhook of the workspace's own
 * bot with a fresh secret and greets the chat. The bot must be dedicated to CONSYRION – a webhook replaces polling.
 */
export const POST = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`telegram-inbound:${actor.userId}`, 10, 60_000);
  const db = await getDb();
  await assertEntitlement(db, actor.organizationId, "mcp");
  const base = appUrl();
  if (!base.startsWith("https://")) throw new DomainError("CONFIGURATION", "Telegram needs a public https address of this server (BETTER_AUTH_URL)");
  const id = (await params).id;
  const secret = randomBytes(24).toString("base64url");
  // The bot speaks the language the interface shows: cookie, else the browser's Accept-Language – like i18n/request.ts
  // (live test 08.11.26: no cookie, German interface, English bot).
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(chosen) ? chosen : localeFromAcceptLanguage(_request.headers.get("accept-language"));
  const { botToken, chatId } = await enableTelegramInbound(db, actor, getKeyring(), id, secret, locale);
  try {
    await telegramCall(fetch, botToken, "setWebhook", {
      url: `${base}/api/telegram/${id}`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    // Command list and greeting in the stored language (live test 08.11.26: German bot, English greeting and "Help").
    const de = locale === "de";
    await telegramCall(fetch, botToken, "setMyCommands", {
      commands: de
        ? [
            { command: "frage", description: "CONSYRION AI nach einer Entscheidung fragen" },
            { command: "offen", description: "Was auf dich wartet" },
            { command: "hilfe", description: "Hilfe" },
          ]
        : [
            { command: "frage", description: "Ask CONSYRION AI for a decision" },
            { command: "offen", description: "What is waiting for you" },
            { command: "hilfe", description: "Help" },
          ],
    }).catch(() => undefined);
    await telegramCall(fetch, botToken, "sendMessage", {
      chat_id: chatId,
      text: de
        ? "CONSYRION AI ist verbunden. Schreib /hilfe, um zu sehen, wie du Fragen stellst."
        : "CONSYRION AI is connected. Send /hilfe to see how to ask.",
    });
  } catch (error) {
    await disableTelegramInbound(db, actor, getKeyring(), id).catch(() => undefined);
    throw new DomainError("VALIDATION", `Telegram refused: ${error instanceof Error ? error.message.replace(/bot\d+:[\w-]+/g, "bot…") : "unknown"}`);
  }
  return NextResponse.json({ ok: true });
});

/** Switches questions off and removes the webhook. */
export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  const { botToken } = await disableTelegramInbound(await getDb(), actor, getKeyring(), (await params).id);
  await telegramCall(fetch, botToken, "deleteWebhook", {}).catch(() => undefined);
  return NextResponse.json({ ok: true });
});
