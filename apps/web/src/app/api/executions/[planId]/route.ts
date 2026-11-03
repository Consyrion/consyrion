import { getExecutionView } from "@consyrion/build";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  return NextResponse.json(await getExecutionView(await getDb(), actor, (await params).planId));
});
