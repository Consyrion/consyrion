import { setSkillHidden } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Hide or show a public skill: { hidden: boolean, reason? } – a reason is required to hide (#368 PR 5). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = ((await readJson(request)) ?? {}) as { hidden?: unknown; reason?: unknown };
  await setSkillHidden(await getDb(), admin, decodeURIComponent((await params).id), body.hidden === true, typeof body.reason === "string" ? body.reason : null);
  return NextResponse.json({ ok: true });
});
