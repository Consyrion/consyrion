import { getSkillHubState } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The author's SkillHub state of a skill (#368): address, public version, review status and notes per version. */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  return NextResponse.json(await getSkillHubState(await getDb(), actor, decodeURIComponent((await params).id)));
});
