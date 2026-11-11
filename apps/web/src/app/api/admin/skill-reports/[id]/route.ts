import { resolveSkillReport } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Closes a report: { status: "resolved" | "dismissed" } (#368 PR 6). Hiding is a separate admin action. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = ((await readJson(request)) ?? {}) as { status?: unknown };
  await resolveSkillReport(await getDb(), admin, decodeURIComponent((await params).id), body.status === "resolved" ? "resolved" : "dismissed");
  return NextResponse.json({ ok: true });
});
