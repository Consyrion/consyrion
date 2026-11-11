import { decidePlan } from "@consyrium/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Human decision on the Execution Council's plan: { action: "approve" | "reject", comment? }. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  const result = await decidePlan(await getDb(), actor, (await params).planId, (await readJson(request)) as never);
  return NextResponse.json(result);
});
