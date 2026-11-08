import { listOfficialSkillsForAdmin } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Official skills in the public catalog with version, hash, scan light and visibility (#368 PR 7). */
export const GET = handle(async () => {
  const admin = await requirePlatformAdminContext();
  return NextResponse.json({ skills: await listOfficialSkillsForAdmin(await getDb(), admin) });
});
