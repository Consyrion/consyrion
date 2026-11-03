import { assertCan } from "@consyrion/core";
import { signState } from "@consyrion/github";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { requireGitHubConfig, stateSecret } from "@/lib/server/github";

/** Sends an owner/admin to GitHub to install the Consyrion app on chosen repositories. */
export const GET = handle(async () => {
  const actor = await requireActor();
  assertCan(actor.role, "org:manage");
  const config = requireGitHubConfig();
  const state = signState(stateSecret(), { organizationId: actor.organizationId, userId: actor.userId });
  return NextResponse.redirect(`https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`);
});
