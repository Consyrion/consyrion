import { cancelSession } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  await cancelSession(await getDb(), actor, (await params).id);
  return NextResponse.json({ ok: true });
});
