import {
  canPublish,
  canReviewTransition,
  DomainError,
  normalizeSkillReviewerSettings,
  PUBLICATION_SCAN_RULES_VERSION,
  SKILL_REVIEWER_SETTING,
  type PublicationScanResult,
  type HubKind,
  type RoleProfileContent,
  type SkillContent,
  type SkillReviewActor,
  type SkillReviewLight,
  type SkillReviewStatus,
  scanHubContent,
  validateHubContent,
} from "@consyrium/core";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { skill, skillModerationLog, skillPublisher, skillVersion, user } from "../schema";
import { assertPlatformAdmin, type PlatformAdminContext } from "./feedback";
import { getPlatformSetting } from "./platform-settings";

/**
 * SkillHub admin queue (#368 PR 5, ADR docs/adr/0368-skillhub.md decision 4). Only platform admins (a context issued by
 * resolvePlatformAdmin). Rules:
 * - Red (static scan or model review) is never publishable, not even by an admin.
 * - An approval refers to one version by content hash: a version that changed or was re-scanned under newer rules is
 *   checked again in the same transaction before it goes public.
 * - Auto-approval is opt-in (admin switch, off by default) and only for green in both checks; every automatic approval
 *   is logged as `auto_approve` with actor null.
 * - Hiding a skill, suspending a publisher and every decision are written to `skill_moderation_log`.
 */

export type ModerationDecision = "approve" | "reject" | "quarantine" | "restore";

export interface ReviewQueueItem {
  skillId: string;
  /** HubKind (#368): decision skill or expert profile. */
  kind: HubKind;
  name: string;
  version: number;
  status: SkillReviewStatus;
  contentHash: string;
  handle: string | null;
  slug: string | null;
  listed: boolean;
  publicVersion: number | null;
  hidden: boolean;
  scanLight: SkillReviewLight | null;
  aiLight: SkillReviewLight | null;
  aiSkipped: string | null;
  submittedAt: Date | null;
  publisherSuspended: boolean;
  ownerUserId: string;
}

const aiLightOf = (review: unknown): { light: SkillReviewLight | null; skipped: string | null } => {
  const r = (review ?? {}) as { light?: SkillReviewLight; skipped?: string };
  return { light: r.light ?? null, skipped: r.skipped ?? null };
};

/** Versions waiting for a decision (default), blocked ones, or the public ones. Oldest submissions first. */
export async function listSkillReviewQueue(
  db: Database,
  admin: PlatformAdminContext,
  filter: { status?: "pending_review" | "quarantined" | "published" } = {},
): Promise<ReviewQueueItem[]> {
  assertPlatformAdmin(admin);
  const status = filter.status ?? "pending_review";
  const rows = await db
    .select({ skill, version: skillVersion, publisher: skillPublisher })
    .from(skillVersion)
    .innerJoin(skill, eq(skill.id, skillVersion.skillId))
    .leftJoin(skillPublisher, eq(skillPublisher.userId, skill.ownerUserId))
    .where(eq(skillVersion.reviewStatus, status))
    .orderBy(skillVersion.submittedAt);
  return rows.map(({ skill: s, version: v, publisher: p }) => {
    const ai = aiLightOf(v.aiReview);
    return {
      skillId: s.id,
      kind: s.kind,
      name: s.name,
      version: v.version,
      status: v.reviewStatus,
      contentHash: v.contentHash,
      handle: p?.handle ?? null,
      slug: s.slug,
      listed: s.listed,
      publicVersion: s.publicVersion,
      hidden: Boolean(s.hiddenAt),
      scanLight: v.scanResult?.light ?? null,
      aiLight: ai.light,
      aiSkipped: ai.skipped,
      submittedAt: v.submittedAt,
      publisherSuspended: Boolean(p?.suspendedAt),
      ownerUserId: s.ownerUserId,
    };
  });
}

export interface ReviewItemDetail extends ReviewQueueItem {
  /** SkillContent or RoleProfileContent, depending on `kind`. */
  content: SkillContent | RoleProfileContent;
  changelog: string | null;
  scan: PublicationScanResult | null;
  aiReview: Record<string, unknown> | null;
  reviewNote: string | null;
  ownerEmail: string | null;
  log: Array<{ action: string; fromStatus: string | null; toStatus: string | null; actorUserId: string | null; createdAt: Date; detail: unknown }>;
}

/** Full content of one version for the moderator, with both checks and the audit trail. Shown as plain text only. */
export async function getSkillReviewItem(db: Database, admin: PlatformAdminContext, skillId: string, version: number): Promise<ReviewItemDetail> {
  assertPlatformAdmin(admin);
  const [row] = await db
    .select({ skill, version: skillVersion, publisher: skillPublisher, ownerEmail: user.email })
    .from(skillVersion)
    .innerJoin(skill, eq(skill.id, skillVersion.skillId))
    .leftJoin(skillPublisher, eq(skillPublisher.userId, skill.ownerUserId))
    .leftJoin(user, eq(user.id, skill.ownerUserId))
    .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.version, version)));
  if (!row) throw new DomainError("NOT_FOUND", "Skill version not found");
  const log = await db.select().from(skillModerationLog).where(eq(skillModerationLog.skillId, skillId)).orderBy(desc(skillModerationLog.createdAt));
  const ai = aiLightOf(row.version.aiReview);
  return {
    skillId,
    kind: row.skill.kind,
    name: row.skill.name,
    version,
    status: row.version.reviewStatus,
    contentHash: row.version.contentHash,
    handle: row.publisher?.handle ?? null,
    slug: row.skill.slug,
    listed: row.skill.listed,
    publicVersion: row.skill.publicVersion,
    hidden: Boolean(row.skill.hiddenAt),
    scanLight: row.version.scanResult?.light ?? null,
    aiLight: ai.light,
    aiSkipped: ai.skipped,
    submittedAt: row.version.submittedAt,
    publisherSuspended: Boolean(row.publisher?.suspendedAt),
    ownerUserId: row.skill.ownerUserId,
    content: row.version.content as unknown as SkillContent | RoleProfileContent,
    changelog: row.version.changelog,
    scan: row.version.scanResult ?? null,
    aiReview: row.version.aiReview ?? null,
    reviewNote: row.version.reviewNote,
    ownerEmail: row.ownerEmail ?? null,
    log: log.map((l) => ({
      action: l.action,
      fromStatus: l.fromStatus,
      toStatus: l.toStatus,
      actorUserId: l.actorUserId,
      createdAt: l.createdAt,
      detail: l.detail,
    })),
  };
}

const TARGET: Record<ModerationDecision, SkillReviewStatus> = {
  approve: "published",
  reject: "rejected",
  quarantine: "quarantined",
  restore: "pending_review",
};
const ACTION: Record<ModerationDecision, string> = { approve: "approve", reject: "reject", quarantine: "quarantine", restore: "restore" };

/**
 * One decision on one version. `contentHash` must match the version the admin looked at. Publishing replaces an
 * earlier public version (that one becomes `withdrawn`, "replaced by version N").
 */
export async function decideSkillVersion(
  db: Database,
  admin: PlatformAdminContext,
  input: { skillId: string; version: number; contentHash: string; decision: ModerationDecision; note?: string | null },
  now = new Date(),
) {
  assertPlatformAdmin(admin);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  if ((input.decision === "reject" || input.decision === "quarantine") && !note)
    throw new DomainError("VALIDATION", "Give the author a reason.", { reason: "note_missing" });
  return applyDecision(db, { actor: "admin", userId: admin.userId }, input, note || null, now);
}

/**
 * System step after the model review (submission flow): publishes only when the admin switch is on and both checks are
 * green. Returns whether it published.
 */
export async function autoApproveSkillVersionIfAllowed(db: Database, ref: { skillId: string; version: number }, now = new Date()): Promise<boolean> {
  const settings = normalizeSkillReviewerSettings((await getPlatformSetting(db, SKILL_REVIEWER_SETTING))?.value);
  if (!settings.autoApproveGreen) return false;
  const [row] = await db
    .select()
    .from(skillVersion)
    .where(and(eq(skillVersion.skillId, ref.skillId), eq(skillVersion.version, ref.version)));
  if (!row || row.reviewStatus !== "pending_review") return false;
  const scanLight = row.scanResult?.light ?? "yellow";
  if (!canPublish({ actor: "system", scanLight, aiLight: aiLightOf(row.aiReview).light, autoApproveGreen: true })) return false;
  await applyDecision(
    db,
    { actor: "system", userId: null },
    { ...ref, contentHash: row.contentHash, decision: "approve" },
    "Approved automatically (green in both checks)",
    now,
  );
  return true;
}

async function applyDecision(
  db: Database,
  who: { actor: Extract<SkillReviewActor, "admin" | "system">; userId: string | null },
  input: { skillId: string; version: number; contentHash: string; decision: ModerationDecision },
  note: string | null,
  now: Date,
) {
  const to = TARGET[input.decision];
  return db.transaction(async (tx) => {
    // Lock the skill row: two decisions on one skill never interleave.
    const [s] = await tx.select().from(skill).where(eq(skill.id, input.skillId)).for("update");
    const [v] = await tx
      .select()
      .from(skillVersion)
      .where(and(eq(skillVersion.skillId, input.skillId), eq(skillVersion.version, input.version)));
    if (!s || !v) throw new DomainError("NOT_FOUND", "Skill version not found");
    if (v.contentHash !== input.contentHash)
      throw new DomainError("VALIDATION", "This version changed – reload it before deciding.", { reason: "hash_mismatch" });
    if (!canReviewTransition(v.reviewStatus, to, who.actor))
      throw new DomainError("VALIDATION", `A ${v.reviewStatus} version cannot be moved to ${to}.`, { reason: "invalid_transition", from: v.reviewStatus });

    let scan = v.scanResult;
    if (input.decision === "approve" || input.decision === "restore") {
      // Re-check under the current rules before anything goes (back) towards public.
      if (!scan || scan.rulesVersion !== PUBLICATION_SCAN_RULES_VERSION) {
        const checked = validateHubContent(s.kind, v.content);
        if (!checked.ok) throw new DomainError("VALIDATION", checked.errors.join("; "));
        scan = scanHubContent(s.kind, checked.content, { changelog: v.changelog });
        await tx.update(skillVersion).set({ scanResult: scan }).where(eq(skillVersion.id, v.id));
        await tx.insert(skillModerationLog).values({
          id: newId("sml"),
          skillId: s.id,
          version: v.version,
          actorUserId: null,
          action: "rescan",
          detail: { light: scan.light, rulesVersion: scan.rulesVersion },
        });
      }
      if (scan.light === "red")
        throw new DomainError("VALIDATION", "Red versions can never be published – the author submits a new version.", { reason: "red" });
    }
    if (input.decision === "approve") {
      const [publisher] = await tx.select().from(skillPublisher).where(eq(skillPublisher.userId, s.ownerUserId));
      if (publisher?.suspendedAt) throw new DomainError("VALIDATION", "The publisher is suspended.", { reason: "publisher_suspended" });
      if (!canPublish({ actor: who.actor, scanLight: scan!.light, aiLight: aiLightOf(v.aiReview).light, autoApproveGreen: who.actor === "system" }))
        throw new DomainError("VALIDATION", "Red versions can never be published – the author submits a new version.", { reason: "red" });
      if (s.publicVersion !== null && s.publicVersion !== v.version) {
        await tx
          .update(skillVersion)
          .set({ reviewStatus: "withdrawn", reviewNote: `Replaced by version ${v.version}` })
          .where(and(eq(skillVersion.skillId, s.id), eq(skillVersion.version, s.publicVersion), eq(skillVersion.reviewStatus, "published")));
        await tx.insert(skillModerationLog).values({
          id: newId("sml"),
          skillId: s.id,
          version: s.publicVersion,
          actorUserId: who.userId,
          action: "withdraw",
          fromStatus: "published",
          toStatus: "withdrawn",
          detail: { replacedBy: v.version },
        });
      }
    }

    await tx
      .update(skillVersion)
      .set({
        reviewStatus: to,
        reviewedById: who.userId,
        reviewedAt: now,
        reviewNote: note,
        ...(to === "published" ? { publishedAt: now } : {}),
      })
      .where(eq(skillVersion.id, v.id));
    const publicVersion = to === "published" ? v.version : s.publicVersion === v.version ? null : s.publicVersion;
    if (publicVersion !== s.publicVersion) await tx.update(skill).set({ publicVersion, updatedAt: now }).where(eq(skill.id, s.id));
    await tx.insert(skillModerationLog).values({
      id: newId("sml"),
      skillId: s.id,
      version: v.version,
      actorUserId: who.userId,
      action: who.actor === "system" ? "auto_approve" : ACTION[input.decision],
      fromStatus: v.reviewStatus,
      toStatus: to,
      detail: {
        contentHash: v.contentHash,
        note,
        scanLight: scan?.light ?? null,
        aiLight: aiLightOf(v.aiReview).light,
        rulesVersion: scan?.rulesVersion ?? null,
      },
    });
    return { skillId: s.id, version: v.version, status: to, publicVersion };
  });
}

/** Hide or show a public skill (never deletes; the author keeps seeing it with the reason). */
export async function setSkillHidden(db: Database, admin: PlatformAdminContext, skillId: string, hidden: boolean, reason?: string | null, now = new Date()) {
  assertPlatformAdmin(admin);
  const text = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (hidden && !text) throw new DomainError("VALIDATION", "Give the author a reason.", { reason: "note_missing" });
  const [s] = await db.select().from(skill).where(eq(skill.id, skillId));
  if (!s) throw new DomainError("NOT_FOUND", "Skill not found");
  await db.transaction(async (tx) => {
    await tx
      .update(skill)
      .set(hidden ? { hiddenAt: now, hiddenReason: text, updatedAt: now } : { hiddenAt: null, hiddenReason: null, updatedAt: now })
      .where(eq(skill.id, skillId));
    await tx.insert(skillModerationLog).values({
      id: newId("sml"),
      skillId,
      version: s.publicVersion,
      actorUserId: admin.userId,
      action: hidden ? "hide" : "unhide",
      detail: { reason: text || null },
    });
  });
}

/** Suspend or restore a publisher. Suspension blocks submissions and approvals and hides their public skills. */
export async function setPublisherSuspended(
  db: Database,
  admin: PlatformAdminContext,
  userId: string,
  suspended: boolean,
  reason?: string | null,
  now = new Date(),
) {
  assertPlatformAdmin(admin);
  const text = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (suspended && !text) throw new DomainError("VALIDATION", "Give a reason.", { reason: "note_missing" });
  const [publisher] = await db.select().from(skillPublisher).where(eq(skillPublisher.userId, userId));
  if (!publisher) throw new DomainError("NOT_FOUND", "Publisher not found");
  await db.transaction(async (tx) => {
    await tx
      .update(skillPublisher)
      .set(suspended ? { suspendedAt: now, suspendedReason: text, updatedAt: now } : { suspendedAt: null, suspendedReason: null, updatedAt: now })
      .where(eq(skillPublisher.userId, userId));
    const publicSkills = await tx
      .select({ id: skill.id, publicVersion: skill.publicVersion })
      .from(skill)
      .where(and(eq(skill.ownerUserId, userId), isNotNull(skill.publicVersion)));
    if (suspended && publicSkills.length)
      await tx
        .update(skill)
        .set({ hiddenAt: now, hiddenReason: `Publisher suspended: ${text}`, updatedAt: now })
        .where(
          inArray(
            skill.id,
            publicSkills.map((p) => p.id),
          ),
        );
    for (const p of publicSkills.length ? publicSkills : [])
      await tx.insert(skillModerationLog).values({
        id: newId("sml"),
        skillId: p.id,
        version: p.publicVersion,
        actorUserId: admin.userId,
        action: suspended ? "suspend_publisher" : "unsuspend_publisher",
        detail: { reason: text || null, handle: publisher.handle },
      });
  });
}

export interface RescanSummary {
  checked: number;
  rescanned: number;
  /** Versions that turned red under the current rules and were moved to `quarantined` (public ones leave the hub). */
  quarantined: Array<{ skillId: string; version: number; wasPublic: boolean }>;
}

/**
 * Re-scan after a rule change (#368 PR 7, ADR "re-scan all public versions"): every version that is waiting, public or
 * blocked and was scanned under older rules is scanned again. A waiting or public version that is red now goes to
 * `quarantined` (a public one leaves the hub immediately); every rescan is logged. Never lowers a light by itself –
 * a blocked version stays blocked until an admin puts it back into review.
 */
export async function rescanSkillVersions(db: Database, admin: PlatformAdminContext, now = new Date()): Promise<RescanSummary> {
  assertPlatformAdmin(admin);
  const rows = await db
    .select({ version: skillVersion, skill })
    .from(skillVersion)
    .innerJoin(skill, eq(skill.id, skillVersion.skillId))
    .where(inArray(skillVersion.reviewStatus, ["pending_review", "published", "quarantined"]));
  const summary: RescanSummary = { checked: rows.length, rescanned: 0, quarantined: [] };
  for (const { version: v, skill: s } of rows) {
    if (v.scanResult?.rulesVersion === PUBLICATION_SCAN_RULES_VERSION) continue;
    const checked = validateHubContent(s.kind, v.content);
    if (!checked.ok) continue;
    const scan = scanHubContent(s.kind, checked.content, { changelog: v.changelog });
    summary.rescanned++;
    const toQuarantine = scan.light === "red" && v.reviewStatus !== "quarantined";
    await db.transaction(async (tx) => {
      await tx
        .update(skillVersion)
        .set({
          scanResult: scan,
          ...(toQuarantine ? { reviewStatus: "quarantined", reviewNote: "Blocked by the updated publication check", reviewedAt: now } : {}),
        })
        .where(eq(skillVersion.id, v.id));
      const wasPublic = toQuarantine && s.publicVersion === v.version;
      if (wasPublic) await tx.update(skill).set({ publicVersion: null, updatedAt: now }).where(eq(skill.id, s.id));
      await tx.insert(skillModerationLog).values({
        id: newId("sml"),
        skillId: s.id,
        version: v.version,
        actorUserId: admin.userId,
        action: "rescan",
        fromStatus: v.reviewStatus,
        toStatus: toQuarantine ? "quarantined" : v.reviewStatus,
        detail: { light: scan.light, rulesVersion: scan.rulesVersion, previousRulesVersion: v.scanResult?.rulesVersion ?? null },
      });
    });
    if (toQuarantine) summary.quarantined.push({ skillId: s.id, version: v.version, wasPublic: s.publicVersion === v.version });
  }
  return summary;
}
