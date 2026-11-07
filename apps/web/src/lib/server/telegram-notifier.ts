import { getDb } from "./db";
import { getKeyring } from "./keyring";
import { logger } from "./logger";
import { telegramNotifierTick } from "./telegram-bot";

const globalForNotifier = globalThis as unknown as { consyrionTelegramNotifier?: ReturnType<typeof setInterval> };

/** Every 30 s: verdicts of councils started over Telegram go back to their chat (one web process runs it). */
export function startTelegramNotifier() {
  if (globalForNotifier.consyrionTelegramNotifier || process.env.TELEGRAM_NOTIFIER === "off") return;
  let keyring;
  try {
    keyring = getKeyring();
  } catch {
    return; // no master key → no connections can be decrypted
  }
  const appUrl = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  let running = false;
  globalForNotifier.consyrionTelegramNotifier = setInterval(() => {
    if (running) return;
    running = true;
    void getDb()
      .then((db) => telegramNotifierTick(db, keyring, appUrl))
      .catch((error) => logger.error("telegram notifier failed", { error: error instanceof Error ? error.name : typeof error }))
      .finally(() => {
        running = false;
      });
  }, 30_000);
}
