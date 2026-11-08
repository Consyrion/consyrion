import { DomainError } from "@consyrion/core";
import { assertRepositoryLinked, getGitHubIntegration } from "@consyrion/db";
import { installationClient, listPullRequests, readPullRequest } from "@consyrion/github";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";
import { rateLimit } from "@/lib/server/rate-limit";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Existing pull requests of one repository linked to a project of this workspace (#18, #402), read-only:
 * `?integrationId=&repository=owner/name[&state=open|closed|all]` lists them, `&number=` returns one with its
 * changed files (diffs filtered like repository snapshots). The token is scoped to that repository.
 */
export const GET = handle(async (request: Request) => {
  const actor = await requireActor();
  rateLimit(`github-pulls:${actor.userId}`, 30, 60_000);
  const params = new URL(request.url).searchParams;
  const integrationId = params.get("integrationId");
  const repository = params.get("repository") ?? "";
  if (!integrationId) throw new DomainError("VALIDATION", "integrationId is required");
  if (!REPOSITORY.test(repository)) throw new DomainError("VALIDATION", "repository must be owner/name");
  const state = params.get("state") ?? "open";
  if (state !== "open" && state !== "closed" && state !== "all") throw new DomainError("VALIDATION", "state must be open, closed or all");
  const db = await getDb();
  const integration = await getGitHubIntegration(db, actor, integrationId);
  // Only repositories a project of this workspace is linked to (#402), not everything the installation grants.
  await assertRepositoryLinked(db, actor, integration.id, repository);
  const client = await installationClient(requireGitHubConfig(), integration.installationId, repository);
  const repo = { fullName: repository, defaultBranch: "", private: true };
  const number = params.get("number");
  if (number !== null) {
    if (!/^[1-9]\d{0,8}$/.test(number)) throw new DomainError("VALIDATION", "number must be a pull request number");
    return NextResponse.json({ pullRequest: await readPullRequest(client, repo, Number(number)) });
  }
  return NextResponse.json({ pullRequests: await listPullRequests(client, repo, state) });
});
