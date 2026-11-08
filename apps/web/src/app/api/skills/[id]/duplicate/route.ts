import { duplicateSkill } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** One-click copy of an official or team skill (#422): a private skill with `forkedFrom`, counted in the plan limit. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { name?: unknown } | null;
  return NextResponse.json(await duplicateSkill(await getDb(), actor, decodeURIComponent((await params).id), { name: body?.name }), { status: 201 });
});
