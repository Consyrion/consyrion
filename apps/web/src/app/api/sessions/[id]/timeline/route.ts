import { sessionTimeline } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/**
 * #12: ordered run events with a resumable cursor – `?after=<cursor>&limit=200`. Ids, kinds and figures only (no text).
 * Events of the last seconds are held back until settled, so resuming never skips a late commit.
 */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 200);
  return NextResponse.json(
    await sessionTimeline(await getDb(), actor, (await params).id, { after: url.searchParams.get("after"), limit: Number.isFinite(limit) ? limit : 200 }),
  );
});
