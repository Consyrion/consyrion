import { createRoleProfile, listRoleProfiles } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Expert Library (#270): curated, own and team role profiles; create a profile (private by default). */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ profiles: await listRoleProfiles(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { content?: unknown; visibility?: "private" | "team" };
  return NextResponse.json(await createRoleProfile(await getDb(), actor, { content: body?.content, visibility: body?.visibility }), { status: 201 });
});
