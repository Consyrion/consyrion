import { DomainError } from "@consyrion/core";
import { getGitHubIntegration } from "@consyrion/db";
import { installationClient, listInstallationRepositories } from "@consyrion/github";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";

/** Repositories the installation grants access to (the user chose them on GitHub). */
export const GET = handle(async (request: Request) => {
  const actor = await requireActor();
  const integrationId = new URL(request.url).searchParams.get("integrationId");
  if (!integrationId) throw new DomainError("VALIDATION", "integrationId is required");
  const integration = await getGitHubIntegration(await getDb(), actor, integrationId);
  const client = await installationClient(requireGitHubConfig(), integration.installationId, null);
  return NextResponse.json({ repositories: await listInstallationRepositories(client) });
});
