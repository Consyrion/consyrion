import { telegramInboundForWebhook } from "@consyrion/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { logger } from "@/lib/server/logger";
import { rateLimit } from "@/lib/server/rate-limit";
import { handleTelegramUpdate } from "@/lib/server/telegram-bot";

type Params = { params: Promise<{ connectionId: string }> };

/**
 * Webhook of a workspace's own Telegram bot (questions over Telegram, 06.11.26). Telegram sends the secret we
 * registered in `X-Telegram-Bot-Api-Secret-Token`. Always 200 – a wrong secret, an unknown connection or a foreign chat
 * does nothing and reveals nothing; errors are logged, never retried by Telegram.
 */
export async function POST(request: Request, { params }: Params) {
  const { connectionId } = await params;
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!secret) return NextResponse.json({ ok: true });
    const db = await getDb();
    const inbound = await telegramInboundForWebhook(db, getKeyring(), connectionId, secret);
    if (!inbound) return NextResponse.json({ ok: true });
    rateLimit(`telegram:${connectionId}`, 30, 60_000);
    const update = (await request.json().catch(() => ({}))) as Parameters<typeof handleTelegramUpdate>[0];
    const appUrl = (process.env.BETTER_AUTH_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    await handleTelegramUpdate(update, { db, keyring: getKeyring(), inbound, appUrl });
  } catch (error) {
    logger.error("telegram webhook failed", { error: error instanceof Error ? error.name : typeof error });
  }
  return NextResponse.json({ ok: true });
}
