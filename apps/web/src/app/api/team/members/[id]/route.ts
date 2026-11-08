import { changeMemberRole, removeMember } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ sessionOnly: true });
  await changeMemberRole(await getDb(), actor, (await params).id, String(((await readJson(request)) as { role?: string }).role));
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ sessionOnly: true });
  await removeMember(await getDb(), actor, (await params).id);
  return new NextResponse(null, { status: 204 });
});
