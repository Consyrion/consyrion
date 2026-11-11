import { FEEDBACK_KINDS, FEEDBACK_STATES, countNewFeedback, listFeedbackForAdmin, type FeedbackKind, type FeedbackState } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Feedback inbox for platform admins (#295): ?kind=bug|feature|contact&state=new|in_progress|done. */
export const GET = handle(async (request: Request) => {
  const admin = await requirePlatformAdminContext();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const state = params.get("state");
  const db = await getDb();
  const [reports, newCount] = await Promise.all([
    listFeedbackForAdmin(db, admin, {
      kind: (FEEDBACK_KINDS as readonly string[]).includes(kind ?? "") ? (kind as FeedbackKind) : null,
      state: (FEEDBACK_STATES as readonly string[]).includes(state ?? "") ? (state as FeedbackState) : null,
    }),
    countNewFeedback(db, admin),
  ]);
  return NextResponse.json({ reports, newCount });
});
