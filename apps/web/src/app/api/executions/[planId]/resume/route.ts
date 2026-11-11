import { resumeExecution } from "@consyrium/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Resumes a failed run: only failed tasks run again, optionally by another council model: { participantId? }. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  const result = await resumeExecution(await getDb(), actor, (await params).planId, (await readJson(request)) as never);
  return NextResponse.json(result);
});
