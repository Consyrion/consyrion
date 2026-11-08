import { listSkillReviewQueue } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** SkillHub review queue for /admin (#368 PR 5): ?status=pending_review (default) | quarantined | published. */
export const GET = handle(async (request: Request) => {
  const admin = await requirePlatformAdminContext();
  const status = new URL(request.url).searchParams.get("status");
  const filter = status === "quarantined" || status === "published" ? { status: status as "quarantined" | "published" } : {};
  return NextResponse.json({ items: await listSkillReviewQueue(await getDb(), admin, filter) });
});
