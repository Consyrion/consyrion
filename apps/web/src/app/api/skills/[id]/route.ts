import { archiveSkill, getSkillForUse, saveSkillVersion, setSkillVisibility } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** One skill: content of the latest (or `?version=`) version, a new version, visibility, archive (#363). */
export const GET = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const raw = new URL(request.url).searchParams.get("version");
  const version = raw ? Number(raw) : undefined;
  return NextResponse.json(await getSkillForUse(await getDb(), actor, decodeURIComponent((await params).id), Number.isInteger(version) ? version : undefined));
});

export const PUT = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { content?: unknown; changelog?: unknown };
  return NextResponse.json(await saveSkillVersion(await getDb(), actor, (await params).id, { content: body?.content, changelog: body?.changelog }));
});

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { visibility?: "private" | "team" };
  await setSkillVisibility(await getDb(), actor, (await params).id, body?.visibility as "private" | "team");
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  await archiveSkill(await getDb(), actor, (await params).id);
  return NextResponse.json({ ok: true });
});
