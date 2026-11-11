import { autoApproveSkillVersionIfAllowed, ownRoleProfileForPublication, saveHubDraft, submitSkillForPublication } from "@consyrium/db";
import { NextResponse } from "next/server";
import { getSessionUser, requireActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { runSkillAiReview } from "@/lib/server/skill-review";
import { assertSkillHubPublishEnabled } from "@/lib/server/skillhub-flag";

/**
 * Submits the latest version of an own role profile to the public SkillHub (owner decision 08.11.26): the same pipeline
 * as skills – static scan (red → quarantined), model review (BYOK exception of ADR 0368, extended to profiles with the
 * same cap), admin decision. Body: { slug?, listed?, changelog, license }. Nothing is published here.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSkillHubPublishEnabled();
  const actor = await requireActor();
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const db = await getDb();
  const profileId = decodeURIComponent((await params).id);
  const own = await ownRoleProfileForPublication(db, actor, profileId);
  const draft = await saveHubDraft(db, actor, { kind: "role_profile", sourceId: profileId, name: own.name, content: own.content });
  // Same gate as skills: platform admins are exempt from the 14-day account age only (owner decision 08.11.2026, #566).
  const platformAdmin = isPlatformAdmin(await getSessionUser());
  const result = await submitSkillForPublication(db, actor, draft.skillId, body, new Date(), { platformAdmin });
  const review = result.status === "pending_review" ? await runSkillAiReview(db, getKeyring(), { skillId: result.skillId, version: result.version }) : null;
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
