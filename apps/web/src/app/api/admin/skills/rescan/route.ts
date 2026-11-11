import { rescanSkillVersions } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Re-scans every waiting, public or blocked version scanned under older rules (#368 PR 7). */
export const POST = handle(async () => {
  const admin = await requirePlatformAdminContext();
  return NextResponse.json(await rescanSkillVersions(await getDb(), admin));
});
