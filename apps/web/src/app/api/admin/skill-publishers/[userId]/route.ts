import { setPublisherSuspended } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Suspend or restore a SkillHub publisher: { suspended: boolean, reason? } (#368 PR 5). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = ((await readJson(request)) ?? {}) as { suspended?: unknown; reason?: unknown };
  await setPublisherSuspended(
    await getDb(),
    admin,
    decodeURIComponent((await params).userId),
    body.suspended === true,
    typeof body.reason === "string" ? body.reason : null,
  );
  return NextResponse.json({ ok: true });
});
