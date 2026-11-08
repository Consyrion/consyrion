import { listOpenSkillReports } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Open SkillHub reports for /admin (#368 PR 6). Reports never hide a skill on their own. */
export const GET = handle(async () => {
  const admin = await requirePlatformAdminContext();
  return NextResponse.json({ reports: await listOpenSkillReports(await getDb(), admin) });
});
