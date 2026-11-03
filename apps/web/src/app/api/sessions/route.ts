import { listSessions } from "@consyrion/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async () => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ sessions: await listSessions(await getDb(), actor) });
});
