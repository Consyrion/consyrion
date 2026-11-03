import { DomainError } from "@consyrion/core";
import { getGitHubIntegration, linkRepository } from "@consyrion/db";
import { installationClient, listInstallationRepositories } from "@consyrion/github";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";

const input = z.object({ integrationId: z.string(), fullName: z.string() });

/** Links a repository; the server checks with GitHub that the installation really covers it. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid repository selection");
  const db = await getDb();
  const integration = await getGitHubIntegration(db, actor, parsed.data.integrationId);
  const repos = await listInstallationRepositories(await installationClient(requireGitHubConfig(), integration.installationId, null));
  const repo = repos.find((r) => r.fullName === parsed.data.fullName);
  if (!repo) throw new DomainError("FORBIDDEN", "The GitHub installation has no access to this repository");
  await linkRepository(db, actor, (await params).id, { integrationId: integration.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch });
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  await linkRepository(await getDb(), actor, (await params).id, null);
  return new NextResponse(null, { status: 204 });
});
