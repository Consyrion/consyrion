import { createSkill, listSkills } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Skills (#363): the caller's visible skills (official, own private, team) and creating a new one (private by default). */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ skills: await listSkills(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { content?: unknown; visibility?: "private" | "team" };
  return NextResponse.json(await createSkill(await getDb(), actor, { content: body?.content, visibility: body?.visibility }), { status: 201 });
});
