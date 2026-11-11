import { autoApproveSkillVersionIfAllowed, submitSkillForPublication } from "@consyrium/db";
import { NextResponse } from "next/server";
import { getSessionUser, requireActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { assertSkillHubPublishEnabled } from "@/lib/server/skillhub-flag";
import { getKeyring } from "@/lib/server/keyring";
import { runSkillAiReview } from "@/lib/server/skill-review";

/**
 * Submits the latest version of an own skill for the public SkillHub (#368 PR 4): { slug?, listed?, changelog, license }.
 * Runs the static scan (red → quarantined) and, when it is not red, the model review. Nothing is published here – an
 * admin decides in the queue.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSkillHubPublishEnabled();
  const actor = await requireActor();
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const db = await getDb();
  // Owner decision 08.11.2026: platform admins are exempt from the 14-day account age only (decided here, server-side).
  const platformAdmin = isPlatformAdmin(await getSessionUser());
  const result = await submitSkillForPublication(db, actor, decodeURIComponent((await params).id), body, new Date(), { platformAdmin });
  const review = result.status === "pending_review" ? await runSkillAiReview(db, getKeyring(), { skillId: result.skillId, version: result.version }) : null;
  // Opt-in admin switch (off by default): only green in both checks is published without a human (#368 PR 5).
  const autoApproved = review?.status === "reviewed" ? await autoApproveSkillVersionIfAllowed(db, { skillId: result.skillId, version: result.version }) : false;
  return NextResponse.json(
    {
      ...result,
      status: autoApproved ? "published" : result.status,
      aiReview: review
        ? review.status === "reviewed"
          ? { status: "reviewed", light: review.review.light }
          : { status: "skipped", reason: review.reason }
        : null,
    },
    { status: 201 },
  );
});
