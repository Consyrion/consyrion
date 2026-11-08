import { createInvitation, listInvitations, listMembers } from "@consyrion/db";
import { can } from "@consyrion/core";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { publicOrigin } from "@/lib/server/origin";

export const GET = handle(async () => {
  const actor = await requireActor();
  const db = await getDb();
  return NextResponse.json({ members: await listMembers(db, actor), invitations: can(actor.role, "member:manage") ? await listInvitations(db, actor) : [] });
});

/** Creates an invitation; the link (with the one-time token) is returned once to the inviter. */
export const POST = handle(async (request: Request) => {
  const actor = await requireActor({ sessionOnly: true });
  const { token, id } = await createInvitation(await getDb(), actor, (await readJson(request)) as { email: string; role: string });
  return NextResponse.json({ id, link: `${publicOrigin(request)}/invite/${token}` }, { status: 201 });
});
