import { credentialAdapterResolver, type JobHandler } from "@consyrion/council";
import type { Keyring } from "@consyrion/core";
import type { Database } from "@consyrion/db";
import { githubAppConfigFromEnv } from "@consyrion/github";
import { runExecution } from "./executor";
import { githubRepositoryAccess } from "./github";
import { detectSandbox } from "./sandbox";
import { EXECUTION_JOB } from "./service";

export function executionJobHandlers(db: Database, keyring: Keyring): Record<string, JobHandler> {
  const resolveAdapter = credentialAdapterResolver(db, keyring);
  const github = githubAppConfigFromEnv();
  const repository = github ? githubRepositoryAccess(db, { config: github }) : undefined;
  return {
    [EXECUTION_JOB]: async (job) => runExecution({ db, resolveAdapter, sandbox: await detectSandbox(), repository }, String(job.payload.planId)),
  };
}
