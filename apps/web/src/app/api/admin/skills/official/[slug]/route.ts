import { setOfficialSkillHidden } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Hides or shows an official skill in the public catalog without a deploy: { hidden } (#368 PR 7). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = ((await readJson(request)) ?? {}) as { hidden?: unknown };
  await setOfficialSkillHidden(await getDb(), admin, decodeURIComponent((await params).slug), body.hidden === true);
  return NextResponse.json({ ok: true });
});
