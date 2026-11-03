import { EXECUTION_JOB, executionJobHandlers } from "@consyrion/build";
import { startCouncilWorker, workerCapacityFromEnv } from "@consyrion/council";
import { getDb } from "./db";
import { getKeyring } from "./keyring";
import { logger } from "./logger";

const globalForWorker = globalThis as unknown as { consyrionWorker?: AbortController };

export function startInlineWorker() {
  if (globalForWorker.consyrionWorker) return;
  const controller = new AbortController();
  globalForWorker.consyrionWorker = controller;
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
