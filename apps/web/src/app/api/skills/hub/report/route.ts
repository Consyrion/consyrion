import { reportPublicSkill } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Reports a public SkillHub skill to the admins: { handle, slug, reason, note? } – never hides it on its own (#368 PR 6). */
export const POST = handle(async (request: Request) => {
  const actor = await requireActor({ sessionOnly: true });
  const body = ((await readJson(request)) ?? {}) as { handle?: unknown; slug?: unknown; reason?: unknown; note?: unknown };
  await reportPublicSkill(await getDb(), actor, { handle: String(body.handle ?? ""), slug: String(body.slug ?? ""), reason: body.reason, note: body.note });
  return NextResponse.json({ ok: true }, { status: 201 });
});
