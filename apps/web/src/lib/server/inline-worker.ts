import { EXECUTION_JOB, executionJobHandlers } from "@consyrium/build";
import { startCouncilWorker, workerCapacityFromEnv } from "@consyrium/council";
import { getDb } from "./db";
import { getKeyring } from "./keyring";
import { logger } from "./logger";

const globalForWorker = globalThis as unknown as { consyriumWorker?: AbortController };

export function startInlineWorker() {
  if (globalForWorker.consyriumWorker) return;
  const controller = new AbortController();
  globalForWorker.consyriumWorker = controller;
  void (async () => {
    let keyring;
    try {
      keyring = getKeyring();
    } catch {
      logger.warn("council worker disabled: CREDENTIALS_MASTER_KEY is not set");
      return;
    }
    const db = await getDb();
    logger.info("inline council worker started");
    await startCouncilWorker({
      db,
      keyring,
      ...workerCapacityFromEnv(process.env, EXECUTION_JOB),
      signal: controller.signal,
      extraHandlers: executionJobHandlers(db, keyring),
      onError: (error) => logger.error("worker error", { error }),
    });
  })();
}
