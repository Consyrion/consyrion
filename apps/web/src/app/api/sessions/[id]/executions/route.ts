import { listExecutions, startExecution } from "@consyrion/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  return NextResponse.json({ executions: await listExecutions(await getDb(), actor, (await params).id) });
});

/** Starts the Execution Council. Only possible for an approved decision (checked server-side). */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const execution = await startExecution(await getDb(), actor, (await params).id, (await readJson(request)) as never);
  return NextResponse.json({ execution }, { status: 201 });
});
