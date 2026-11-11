import { withdrawPublishedSkill } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The author takes a published skill out of the SkillHub (#368). Councils keep the version they used. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  await withdrawPublishedSkill(await getDb(), actor, decodeURIComponent((await params).id));
  return NextResponse.json({ ok: true });
});
