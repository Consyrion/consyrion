import { DomainError } from "@consyrion/core";
import { saveGitHubInstallation } from "@consyrion/db";
import { verifyState, verifyUserInstallation } from "@consyrion/github";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig, stateSecret } from "@/lib/server/github";
import { publicOrigin } from "@/lib/server/origin";

/**
 * GitHub "Setup URL" after installation. The signed state must belong to the signed-in user and
 * organization, and the OAuth code proves that this GitHub user can access the installation.
 */
export const GET = handle(async (request: Request) => {
  const actor = await requireActor();
  const url = new URL(request.url);
  const state = verifyState(stateSecret(), url.searchParams.get("state"));
  if (state.organizationId !== actor.organizationId || state.userId !== actor.userId) throw new DomainError("FORBIDDEN", "This GitHub connection was started by another user or workspace");
  const installationId = Number(url.searchParams.get("installation_id"));
  const code = url.searchParams.get("code");
  if (!Number.isInteger(installationId) || installationId <= 0 || !code) throw new DomainError("VALIDATION", "GitHub did not return an installation; enable 'Request user authorization during installation' for the app");
  const installation = await verifyUserInstallation(requireGitHubConfig(), code, installationId);
  await saveGitHubInstallation(await getDb(), actor, { installationId, ...installation });
  return NextResponse.redirect(new URL("/settings/integrations?connected=1", publicOrigin(request)));
});
