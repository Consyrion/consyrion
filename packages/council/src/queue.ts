import { newId, schema, type Database } from "@consyrion/db";
import { eq, sql } from "drizzle-orm";

export type JobRow = typeof schema.job.$inferSelect;

/**
 * Enqueues a job; a duplicate dedupe key (e.g. a double-clicked start) is ignored. `organizationId` is the
 * workspace the job works for, used for fair scheduling (#149).
 */
export async function enqueue(db: Database, kind: string, payload: Record<string, unknown>, dedupeKey?: string, organizationId?: string) {
  await db
    .insert(schema.job)
    .values({ id: newId("job"), kind, payload, dedupeKey: dedupeKey ?? null, organizationId: organizationId ?? null })
    .onConflictDoNothing({ target: schema.job.dedupeKey });
}

/** Scheduling limits of `claimNext` (#149). */
export interface ClaimLimits {
  /** At most this many running jobs per workspace; further jobs of it wait while other workspaces run. */
  perWorkspace?: number;
  /** At most this many running jobs of a kind across all workers (e.g. sandboxed builds). */
  perKind?: Readonly<Record<string, number>>;
}

/** Default share of one workspace: matches the three councils a workspace may run at the same time. */
export const DEFAULT_JOBS_PER_WORKSPACE = 3;

/**
 * Claims the next due job. Jobs whose lock expired (worker crashed) are picked up again, which makes
 * session runs resumable. SKIP LOCKED lets several workers (and several slots of one worker) share the queue
 * safely. Fairness (#149): among due jobs, the workspace with the fewest running jobs goes first, and a workspace
 * at its limit waits. The limits are counted without a lock, so parallel claims may exceed them by one briefly.
 */
export async function claimNext(db: Database, lockMs: number, limits: ClaimLimits = {}): Promise<JobRow | null> {
  const perWorkspace = limits.perWorkspace ?? DEFAULT_JOBS_PER_WORKSPACE;
  const running = (column: "organization_id" | "kind") =>
    sql.raw(`(SELECT count(*) FROM job r WHERE r.${column} = j.${column} AND r.status = 'running' AND r.locked_until >= now() AND r.id <> j.id)`);
  const kindLimits = Object.entries(limits.perKind ?? {}).map(([kind, max]) => sql`(j.kind <> ${kind} OR ${running("kind")} < ${max})`);
  const kindFilter = kindLimits.length ? sql.join(kindLimits, sql` AND `) : sql`true`;
  const result = await db.execute(sql`
    UPDATE ${schema.job} SET status = 'running', attempts = attempts + 1,
      locked_until = now() + (${lockMs} * interval '1 millisecond'), updated_at = now()
    WHERE id = (
      SELECT j.id FROM job j
      WHERE ((j.status = 'queued' AND j.run_at <= now()) OR (j.status = 'running' AND j.locked_until < now()))
        AND (j.organization_id IS NULL OR ${running("organization_id")} < ${perWorkspace})
        AND ${kindFilter}
      ORDER BY ${running("organization_id")}, j.run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows ?? (result as unknown as Array<{ id: string }>);
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(schema.job).where(eq(schema.job.id, id));
  return job ?? null;
}

export async function extendLock(db: Database, jobId: string, lockMs: number) {
  await db.execute(sql`UPDATE ${schema.job} SET locked_until = now() + (${lockMs} * interval '1 millisecond') WHERE id = ${jobId}`);
}

export async function completeJob(db: Database, jobId: string) {
  await db.update(schema.job).set({ status: "done", lockedUntil: null }).where(eq(schema.job.id, jobId));
}

export async function failJob(db: Database, job: JobRow, message: string) {
  const retry = job.attempts < job.maxAttempts;
  await db
    .update(schema.job)
    .set({
      status: retry ? "queued" : "failed",
      lastError: message.slice(0, 500),
      lockedUntil: null,
      runAt: retry ? new Date(Date.now() + 2 ** job.attempts * 5_000) : job.runAt,
    })
    .where(eq(schema.job.id, job.id));
}

export type JobHandler = (job: JobRow) => Promise<void>;

/** Parallel jobs per worker process unless `WORKER_CONCURRENCY` says otherwise (#149). */
export const DEFAULT_WORKER_CONCURRENCY = 4;

/**
 * Polling worker with lock heartbeat. Runs `concurrency` claim loops side by side (#149): a council takes 15–25
 * minutes, so one loop let a single council block every other workspace and every build. Returns when the signal
 * aborts and all running jobs have finished.
 */
export async function runWorker(options: {
  db: Database;
  handlers: Record<string, JobHandler>;
  signal: AbortSignal;
  pollMs?: number;
  lockMs?: number;
  concurrency?: number;
  limits?: ClaimLimits;
  onError?: (error: unknown) => void;
}) {
  const lockMs = options.lockMs ?? 120_000;
  const slots = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_WORKER_CONCURRENCY));
  const loop = async () => {
    while (!options.signal.aborted) {
      const job = await claimNext(options.db, lockMs, options.limits).catch((error) => {
        options.onError?.(error);
        return null;
      });
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 1_000));
        continue;
      }
      const heartbeat = setInterval(() => void extendLock(options.db, job.id, lockMs).catch(options.onError), lockMs / 3);
      try {
        const handler = options.handlers[job.kind];
        if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
        await handler(job);
        await completeJob(options.db, job.id);
      } catch (error) {
        options.onError?.(error);
        await failJob(options.db, job, error instanceof Error ? error.message : "Job failed");
      } finally {
        clearInterval(heartbeat);
      }
    }
  };
  await Promise.all(Array.from({ length: slots }, loop));
}

/** Worker capacity from the environment: `WORKER_CONCURRENCY`, `WORKER_JOBS_PER_WORKSPACE`, `WORKER_MAX_BUILDS`. */
export function workerCapacityFromEnv(env: Record<string, string | undefined>, buildJobKind: string) {
  const int = (value: string | undefined, fallback: number) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  };
  return {
    concurrency: int(env.WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY),
    limits: {
      perWorkspace: int(env.WORKER_JOBS_PER_WORKSPACE, DEFAULT_JOBS_PER_WORKSPACE),
      perKind: { [buildJobKind]: int(env.WORKER_MAX_BUILDS, DEFAULT_MAX_BUILDS) },
    },
  };
}

/** Sandboxed builds use CPU and memory on the worker host; councils mostly wait for providers. */
export const DEFAULT_MAX_BUILDS = 2;
