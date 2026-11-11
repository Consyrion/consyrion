import { listSkillVersions } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Version list of a skill with each version's changelog (#422), newest first. */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  return NextResponse.json({ versions: await listSkillVersions(await getDb(), actor, decodeURIComponent((await params).id)) });
});
