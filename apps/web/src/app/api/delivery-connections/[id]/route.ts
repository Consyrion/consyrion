import { deleteDeliveryConnection } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  await deleteDeliveryConnection(await getDb(), actor, (await params).id);
  return NextResponse.json({ ok: true });
});
