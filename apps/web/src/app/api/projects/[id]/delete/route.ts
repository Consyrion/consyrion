import { deleteProjectPermanently } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Permanent deletion with name confirmation (archiving stays available via DELETE /api/projects/:id). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  const { confirmName } = (await readJson(request)) as { confirmName?: string };
  await deleteProjectPermanently(await getDb(), actor, (await params).id, String(confirmName ?? ""));
  return new NextResponse(null, { status: 204 });
});
