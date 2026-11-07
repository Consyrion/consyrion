/**
 * Starts the in-process council worker when COUNCIL_WORKER=inline (default for local development
 * with embedded PGlite, which only one process may open). With PostgreSQL in production run the
 * separate worker (`pnpm --filter @consyrion/worker start`) and set COUNCIL_WORKER=external.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Verdicts of councils asked over Telegram go back to the chat – in the web process, whatever runs the councils.
  const { startTelegramNotifier } = await import("./lib/server/telegram-notifier");
  startTelegramNotifier();
  const mode = process.env.COUNCIL_WORKER ?? (process.env.DATABASE_URL ? "external" : "inline");
  if (mode !== "inline") return;
  const { startInlineWorker } = await import("./lib/server/inline-worker");
  startInlineWorker();
}
