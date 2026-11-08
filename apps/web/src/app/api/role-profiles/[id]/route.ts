import { archiveRoleProfile, getRoleProfile, saveRoleProfileVersion, setRoleProfileVisibility } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** One role profile (#270): read a version, save a new version, share/unshare, deactivate. */
export const GET = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("version");
  const version = raw ? Number(raw) : undefined;
  return NextResponse.json(await getRoleProfile(await getDb(), actor, decodeURIComponent((await params).id), Number.isInteger(version) ? version : undefined));
});

export const PUT = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { content?: unknown };
  return NextResponse.json(await saveRoleProfileVersion(await getDb(), actor, decodeURIComponent((await params).id), { content: body?.content }));
});

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { visibility?: "private" | "team" };
  await setRoleProfileVisibility(await getDb(), actor, decodeURIComponent((await params).id), body?.visibility as "private" | "team");
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  await archiveRoleProfile(await getDb(), actor, decodeURIComponent((await params).id));
  return NextResponse.json({ ok: true });
});
