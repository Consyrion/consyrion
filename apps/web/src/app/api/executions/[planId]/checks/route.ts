import { pullRequestChecks } from "@consyrium/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  return NextResponse.json({ checks: await pullRequestChecks(await getDb(), actor, (await params).planId, { config: requireGitHubConfig() }) });
});
