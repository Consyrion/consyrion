import { NextResponse } from "next/server";
import { engineInfo } from "@consyrium/council";
import { sql } from "@consyrium/db/sql";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness: 200 when the database answers, 503 otherwise. No internal details leak; `engine` is only the
 * kind (production, test or stub) so a deploy can verify the engine is installed (#188).
 */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "ok", version: process.env.APP_VERSION ?? "dev", engine: engineInfo().kind, latencyMs: Date.now() - started });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
