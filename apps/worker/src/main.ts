/**
 * Council worker for PostgreSQL deployments. Several instances may run in parallel; the job queue
 * uses SKIP LOCKED and lock heartbeats, and interrupted sessions resume from their last checkpoint.
 */
import { EXECUTION_JOB, executionJobHandlers } from "@consyrion/build";
import { keyringFromEnv } from "@consyrion/core";
import { startCouncilWorker, workerCapacityFromEnv } from "@consyrion/council";
import { createDatabase } from "@consyrion/db";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("DATABASE_URL must be a PostgreSQL connection string. For local PGlite development use COUNCIL_WORKER=inline in the web app.");
  process.exit(1);
}

const handle = createDatabase(url);
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());

const capacity = workerCapacityFromEnv(process.env, EXECUTION_JOB);
console.info(
  `[worker] started: ${capacity.concurrency} parallel jobs, ${capacity.limits.perWorkspace} per workspace, ${capacity.limits.perKind[EXECUTION_JOB]} builds`,
);
const keyring = keyringFromEnv(process.env);
await startCouncilWorker({
  db: handle.db,
  keyring,
  ...capacity,
  extraHandlers: executionJobHandlers(handle.db, keyring),
  signal: controller.signal,
  onError: (error) => console.error("[worker]", error instanceof Error ? error.message : error),
});
await handle.close();
console.info("[worker] stopped");
