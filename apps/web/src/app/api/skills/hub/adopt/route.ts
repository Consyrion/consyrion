import { adoptPublicSkill } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Copies a public SkillHub skill into the caller's workspace as a private skill: { handle, slug } (#368 PR 6). */
export const POST = handle(async (request: Request) => {
  const actor = await requireActor({ sessionOnly: true });
  const body = ((await readJson(request)) ?? {}) as { handle?: unknown; slug?: unknown };
  const created = await adoptPublicSkill(await getDb(), actor, String(body.handle ?? ""), String(body.slug ?? ""));
  return NextResponse.json(created, { status: 201 });
});
