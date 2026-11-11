import { deleteSession, getSessionView } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json(await getSessionView(await getDb(), actor, (await params).id));
});

/** #198: deletes this whole council session (typed project name); a running council or active build must stop first. */
export const DELETE = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ sessionOnly: true });
  const body = (await readJson(request)) as { confirmName?: unknown } | null;
  await deleteSession(await getDb(), actor, (await params).id, String(body?.confirmName ?? ""));
  return new NextResponse(null, { status: 204 });
});
