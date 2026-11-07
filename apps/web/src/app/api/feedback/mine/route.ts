import { listMyFeedback } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The signed-in user's own reports with the admins' replies (#295). */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ reports: await listMyFeedback(await getDb(), actor) });
});
