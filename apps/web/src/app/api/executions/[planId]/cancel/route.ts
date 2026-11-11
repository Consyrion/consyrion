import { cancelExecution } from "@consyrium/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const POST = handle(async (_request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  await cancelExecution(await getDb(), actor, (await params).planId);
  return NextResponse.json({ ok: true });
});
