import { modelStrengthStatus, strengthSourceFromEnv, syncModelStrength } from "@consyrion/council";
import { DomainError } from "@consyrion/core";
import { recordAudit } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Model strength catalog status for platform admins (#139): last attempt, last success, configured source. */
export const GET = handle(async () => {
  await requirePlatformAdmin();
  const source = strengthSourceFromEnv(process.env);
  return NextResponse.json({ configured: Boolean(source), source: source?.source ?? null, ...(await modelStrengthStatus(await getDb())) });
});

/** "Refresh now": fetches the ranking immediately instead of waiting for the daily job. */
export const POST = handle(async () => {
  const admin = await requirePlatformAdmin();
  const source = strengthSourceFromEnv(process.env);
  if (!source) throw new DomainError("CONFLICT", "No ranking source configured: set ARTIFICIAL_ANALYSIS_API_KEY on the server");
  const db = await getDb();
  const result = await syncModelStrength(db, source);
  await recordAudit(db, { organizationId: null, actorUserId: admin.id, action: "admin.model_strength_synced", targetType: "model_strength", targetId: source.source });
  return NextResponse.json(result);
});
