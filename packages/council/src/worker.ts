import { createAdapter } from "@consyrion/ai";
import { DomainError, type Keyring } from "@consyrion/core";
import { decryptCredentialForOrganization, type Database } from "@consyrion/db";
import type { AdapterResolver } from "./call";
import { runSession } from "./engine";
import { runWorker, type ClaimLimits, type JobHandler } from "./queue";
import { COUNCIL_JOB } from "./service";
import { MODEL_STRENGTH_JOB, scheduleModelStrengthSync, strengthSourceFromEnv, syncModelStrength, type StrengthSource } from "./model-strength";

/** Production adapter resolver: decrypts the participant's key just before use. */
export function credentialAdapterResolver(db: Database, keyring: Keyring): AdapterResolver {
  return async (participant) => {
    if (!participant.credentialId) throw new Error("The API key of this participant was deleted");
    try {
      const { provider, secret } = await decryptCredentialForOrganization(db, keyring, participant.organizationId, participant.credentialId);
      return createAdapter(provider, secret);
    } catch (error) {
      // Deleted between the start of the run and this call.
      if (error instanceof DomainError && error.code === "NOT_FOUND") throw new Error("The API key of this participant was deleted", { cause: error });
      throw error;
    }
  };
}

export function startCouncilWorker(options: {
  db: Database;
  keyring: Keyring;
  signal: AbortSignal;
  onError?: (error: unknown) => void;
  /** Additional job kinds handled by the same worker (e.g. the Execution Council). */
  extraHandlers?: Record<string, JobHandler>;
  /** Parallel jobs and scheduling limits (#149); see `workerCapacityFromEnv`. */
  concurrency?: number;
  limits?: ClaimLimits;
  /** Ranking source for the model strength catalog; default from the environment, null to switch it off. */
  strengthSource?: StrengthSource | null;
}) {
  const resolveAdapter = credentialAdapterResolver(options.db, options.keyring);
  // Daily model ranking (#139): scheduled at start and then hourly; the dedupe key keeps it to one run a day.
  const strength = options.strengthSource === undefined ? strengthSourceFromEnv(process.env) : options.strengthSource;
  if (strength) {
    const schedule = () => void scheduleModelStrengthSync(options.db).catch(options.onError);
    schedule();
    const timer = setInterval(schedule, 60 * 60_000);
    options.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  }
  return runWorker({
    db: options.db,
    signal: options.signal,
    onError: options.onError,
    concurrency: options.concurrency,
    limits: options.limits,
    handlers: {
      ...options.extraHandlers,
      [MODEL_STRENGTH_JOB]: async () => {
        if (strength) await syncModelStrength(options.db, strength);
      },
      [COUNCIL_JOB]: async (job) => runSession({ db: options.db, resolveAdapter }, String(job.payload.sessionId)),
    },
  });
}
