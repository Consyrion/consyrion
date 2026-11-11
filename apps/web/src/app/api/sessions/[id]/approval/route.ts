import { submitApproval } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** #249 part 2 (owner decision 08.11.26): favourite, prototype build and approval after measurement need a signed-in person. */
const SESSION_ONLY_ACTIONS = new Set(["mark_favorite", "approve_prototype", "approve_after_measurement"]);

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const body = (await readJson(request)) as { action?: unknown } | null;
  const actor = await requireActor({ sessionOnly: SESSION_ONLY_ACTIONS.has(String(body?.action)) });
  return NextResponse.json(await submitApproval(await getDb(), actor, (await params).id, body as never));
});
