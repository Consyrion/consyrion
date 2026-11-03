import { submitApproval } from "@consyrion/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  return NextResponse.json(await submitApproval(await getDb(), actor, (await params).id, (await readJson(request)) as never));
});
