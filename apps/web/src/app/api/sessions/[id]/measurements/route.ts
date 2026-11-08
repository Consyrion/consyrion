import { recordMeasurement } from "@consyrion/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/**
 * #249 gate 2: records a measured result as a self-declaration with evidence. Only a signed-in person with the approval
 * role – never an API token, the MCP server or an agent (owner decision 08.11.26).
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ sessionOnly: true });
  return NextResponse.json(await recordMeasurement(await getDb(), actor, (await params).id, (await readJson(request)) as never), { status: 201 });
});
