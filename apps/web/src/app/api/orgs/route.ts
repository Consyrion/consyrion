import { listOrganizationsForUser } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async () => {
  const actor = await requireActor();
  const organizations = await listOrganizationsForUser(await getDb(), actor.userId);
  return NextResponse.json({ organizations, activeOrganizationId: actor.organizationId });
});
