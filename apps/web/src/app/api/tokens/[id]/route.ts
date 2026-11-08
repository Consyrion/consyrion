import { revokeApiToken } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ sessionOnly: true });
  await revokeApiToken(await getDb(), actor, (await params).id);
  return new NextResponse(null, { status: 204 });
});
