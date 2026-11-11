import { deleteDocument } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) => {
  const actor = await requireActor({ integration: true });
  const { id, docId } = await params;
  await deleteDocument(await getDb(), actor, id, docId);
  return new NextResponse(null, { status: 204 });
});
