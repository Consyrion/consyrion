import { createPullRequestForPlan } from "@consyrion/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";

/**
 * Human action: publish the change set as a draft pull request. The quality gate blocks failed tests and
 * critical findings unless the body carries `overrideReason` (recorded in the PR and the audit log). Changes the
 * repository's CI executes (scripts, lockfiles, build config) need `confirmCiChanges: true` (#400).
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  const body = (await readJson(request).catch(() => ({}))) as { overrideReason?: unknown; confirmCiChanges?: unknown };
  const overrideReason = typeof body?.overrideReason === "string" ? body.overrideReason.slice(0, 500) : undefined;
  // #400: CI-relevant changes (scripts, lockfiles, build config) need an explicit confirmation.
  const confirmCiChanges = body?.confirmCiChanges === true;
  const pr = await createPullRequestForPlan(await getDb(), actor, (await params).planId, { config: requireGitHubConfig() }, { overrideReason, confirmCiChanges });
  return NextResponse.json({ pullRequest: pr }, { status: 201 });
});
