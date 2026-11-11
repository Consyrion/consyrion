import { previewSession, type SessionInput } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Cost and step preview before a session starts (#57). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json(await previewSession(await getDb(), actor, (await params).id, (await readJson(request)) as SessionInput));
});
