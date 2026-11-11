import {
  assertCan,
  canReviewTransition,
  DomainError,
  SKILL_PUBLICATION_LICENSE,
  SKILL_PUBLISHER_MIN_ACCOUNT_AGE_DAYS,
  slugFromName,
  validatePublisherDisplayName,
  validatePublisherHandle,
  validateSkillChangelog,
  validateSkillSlug,
  type PublicationScanResult,
  type SkillReviewStatus,
  hubAdapter,
  scanHubContent,
  type HubKind,
  validateHubContent,
} from "@consyrium/core";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { skill, skillModerationLog, skillPublisher, skillVersion, user } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { getEntitlements } from "./saas";

/**
 * SkillHub submission (#368 PR 4, ADR docs/adr/0368-skillhub.md). An author submits the latest version of an own skill
 * for public use: upload gate (Pro, verified e-mail, account ≥ 14 days, not suspended), handle and slug, CC BY 4.0
 * accepted, changelog required. The version runs the static scan in the same transaction and lands in `pending_review`
 * or – when red – in `quarantined`. Nothing becomes public here; only an admin (or the opt-in auto-approval for green)
 * publishes, in the admin queue (PR 5). Every step is written to `skill_moderation_log`.
 */

export type PublisherEligibilityProblem = "plan" | "email_unverified" | "account_too_new" | "suspended";

export interface SkillPublisherStatus {
  handle: string | null;
  displayName: string | null;
  suspended: boolean;
  problems: PublisherEligibilityProblem[];
  /** When the account reaches the minimum age (only with `account_too_new`). */
  eligibleFrom: string | null;
}

/**
 * `platformAdmin` (owner decision 08.11.2026): platform admins – PLATFORM_ADMIN_EMAILS with a verified address, decided by
 * the route – are exempt from the 14-day account age only. Pro, verified e-mail, scan, model review and the admin approval
 * still apply; the submission is logged with `gateException: "platform_admin"`.
 */
export async function getPublisherStatus(
  db: Database,
  ctx: ActorContext,
  now = new Date(),
  options: { platformAdmin?: boolean } = {},
): Promise<SkillPublisherStatus & { gateException: "platform_admin" | null }> {
  assertCan(ctx.role, "project:read");
  const [account] = await db.select({ emailVerified: user.emailVerified, createdAt: user.createdAt }).from(user).where(eq(user.id, ctx.userId));
  const [publisher] = await db.select().from(skillPublisher).where(eq(skillPublisher.userId, ctx.userId));
  const { entitlements } = await getEntitlements(db, ctx.organizationId);
  const problems: PublisherEligibilityProblem[] = [];
  // Pro: the same entitlement that unlocks team skills (plan definitions stay unchanged).
  if (!entitlements.teamSkills) problems.push("plan");
  if (!account?.emailVerified) problems.push("email_unverified");
  const eligible = account ? new Date(account.createdAt.getTime() + SKILL_PUBLISHER_MIN_ACCOUNT_AGE_DAYS * 86_400_000) : now;
  const tooNew = eligible > now;
  if (tooNew && !options.platformAdmin) problems.push("account_too_new");
  if (publisher?.suspendedAt) problems.push("suspended");
  return {
    handle: publisher?.handle ?? null,
    displayName: publisher?.displayName ?? null,
    suspended: Boolean(publisher?.suspendedAt),
    problems,
    eligibleFrom: problems.includes("account_too_new") ? eligible.toISOString() : null,
    gateException: tooNew && options.platformAdmin ? "platform_admin" : null,
  };
}

/** Claims the caller's publisher handle (once; changing it later would break public links). */
export async function claimPublisherHandle(db: Database, ctx: ActorContext, handle: unknown, options: { allowReserved?: boolean } = {}): Promise<string> {
  assertCan(ctx.role, "project:write");
  const value = typeof handle === "string" ? handle.trim().toLowerCase() : "";
  const problem = validatePublisherHandle(value, { allowReserved: options.allowReserved });
  if (problem)
    throw new DomainError(
      "VALIDATION",
      problem === "reserved"
        ? "This handle is reserved – it would suggest an official or third-party identity."
        : "Use 3–32 lower-case letters, digits or single hyphens.",
      { reason: `handle_${problem}` },
    );
  const [existing] = await db.select().from(skillPublisher).where(eq(skillPublisher.userId, ctx.userId));
  if (existing) {
    if (existing.handle === value) return value;
    throw new DomainError("VALIDATION", "Your publisher handle is already set and cannot be changed.", { reason: "handle_set" });
  }
  const [taken] = await db.select({ userId: skillPublisher.userId }).from(skillPublisher).where(eq(skillPublisher.handle, value));
  if (taken) throw new DomainError("VALIDATION", "This handle is already taken.", { reason: "handle_taken" });
  await db.insert(skillPublisher).values({ userId: ctx.userId, handle: value });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "skill.publisher_claimed",
    targetType: "user",
    targetId: ctx.userId,
  });
  return value;
}

/**
 * Sets or clears the optional public display name (owner request 08.11.2026). The handle stays the unique id;
 * `allowReserved` only for platform admins (e.g. "CONSYRIUM Team"). Audited.
 */
export async function setPublisherDisplayName(db: Database, ctx: ActorContext, name: unknown, options: { allowReserved?: boolean } = {}) {
  assertCan(ctx.role, "project:write");
  const [publisher] = await db.select().from(skillPublisher).where(eq(skillPublisher.userId, ctx.userId));
  if (!publisher) throw new DomainError("VALIDATION", "Choose your publisher handle first.", { reason: "handle_missing" });
  const value = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (value) {
    const problem = validatePublisherDisplayName(value, { allowReserved: options.allowReserved });
    if (problem)
      throw new DomainError(
        "VALIDATION",
        problem === "reserved"
          ? "This name is reserved – it would suggest an official or third-party identity."
          : problem === "length"
            ? "Use 2–60 characters."
            : "This name cannot be used (links, contact data, instructions or hidden characters).",
        { reason: `display_name_${problem}` },
      );
  }
  await db
    .update(skillPublisher)
    .set({ displayName: value || null, updatedAt: new Date() })
    .where(eq(skillPublisher.userId, ctx.userId));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "skill.publisher_name_set",
    targetType: "user",
    targetId: ctx.userId,
  });
}

export interface SubmitSkillInput {
  slug?: unknown;
  listed?: unknown;
  changelog?: unknown;
  /** Must be exactly SKILL_PUBLICATION_LICENSE.id – the author accepts CC BY 4.0 for this version. */
  license?: unknown;
}

export interface SubmitSkillResult {
  skillId: string;
  version: number;
  status: SkillReviewStatus;
  scan: PublicationScanResult;
  slug: string;
}

/** Submits the latest version of an own skill for the public SkillHub. */
export async function submitSkillForPublication(
  db: Database,
  ctx: ActorContext,
  skillId: string,
  input: SubmitSkillInput,
  now = new Date(),
  options: { platformAdmin?: boolean } = {},
): Promise<SubmitSkillResult> {
  assertCan(ctx.role, "project:write");
  const status = await getPublisherStatus(db, ctx, now, options);
  if (status.problems.length)
    throw new DomainError("FORBIDDEN", "Publishing in the SkillHub needs Pro, a verified e-mail and an account at least 14 days old.", {
      reason: "not_eligible",
      problems: status.problems,
      eligibleFrom: status.eligibleFrom,
    });
  if (!status.handle) throw new DomainError("VALIDATION", "Choose your publisher handle first.", { reason: "handle_missing" });
  if (input.license !== SKILL_PUBLICATION_LICENSE.id)
    throw new DomainError("VALIDATION", `Accept the licence (${SKILL_PUBLICATION_LICENSE.name}) to publish.`, { reason: "license_missing" });

  const [row] = await db
    .select({ skill, version: skillVersion })
    .from(skill)
    .innerJoin(skillVersion, and(eq(skillVersion.skillId, skill.id), eq(skillVersion.version, skill.latestVersion)))
    .where(and(eq(skill.id, skillId), eq(skill.organizationId, ctx.organizationId)));
  if (!row || row.skill.ownerUserId !== ctx.userId || row.skill.archivedAt) throw new DomainError("NOT_FOUND", "Skill not found");
  const from = row.version.reviewStatus;
  if (!canReviewTransition(from, "scanning", "author"))
    throw new DomainError("VALIDATION", "This version was already submitted. Save a new version to submit changes.", {
      reason: "already_submitted",
      status: from,
    });

  const changelogResult = validateSkillChangelog(input.changelog ?? row.version.changelog);
  if (!changelogResult.ok) throw new DomainError("VALIDATION", changelogResult.error);
  if (!changelogResult.changelog)
    throw new DomainError("VALIDATION", "Describe what this version contains or changes (changelog).", { reason: "changelog_missing" });
  const changelog = changelogResult.changelog;

  const slug = row.skill.slug ?? (typeof input.slug === "string" && input.slug.trim() ? input.slug.trim().toLowerCase() : slugFromName(row.skill.name));
  const slugProblem = validateSkillSlug(slug);
  if (slugProblem)
    throw new DomainError("VALIDATION", slugProblem === "reserved" ? "This address is reserved." : "Use 3–60 lower-case letters, digits or single hyphens.", {
      reason: `slug_${slugProblem}`,
    });
  if (!row.skill.slug) {
    const [clash] = await db
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.ownerUserId, ctx.userId), eq(skill.slug, slug)));
    if (clash && clash.id !== skillId) throw new DomainError("VALIDATION", "You already use this address for another skill.", { reason: "slug_taken" });
  }

  const checked = validateHubContent(row.skill.kind, row.version.content);
  if (!checked.ok) throw new DomainError("VALIDATION", checked.errors.join("; "));
  const scan = scanHubContent(row.skill.kind, checked.content, { changelog });
  const next: SkillReviewStatus = scan.light === "red" ? "quarantined" : "pending_review";
  const listed = input.listed === undefined ? row.skill.listed : input.listed === true;

  await db.transaction(async (tx) => {
    // The version is bound to its hash: an approval later refers to exactly this content and this scan.
    const updated = await tx
      .update(skillVersion)
      .set({ reviewStatus: next, scanResult: scan, changelog, submittedAt: now, license: SKILL_PUBLICATION_LICENSE.id, licenseAcceptedAt: now })
      .where(and(eq(skillVersion.id, row.version.id), eq(skillVersion.reviewStatus, from)))
      .returning({ id: skillVersion.id });
    if (!updated.length) throw new DomainError("VALIDATION", "This version was submitted at the same time. Reload the page.", { reason: "already_submitted" });
    await tx.update(skill).set({ slug, listed, updatedAt: now }).where(eq(skill.id, skillId));
    const base = { skillId, version: row.version.version, actorUserId: ctx.userId };
    await tx.insert(skillModerationLog).values([
      {
        id: newId("sml"),
        ...base,
        action: "submit",
        fromStatus: from,
        toStatus: "scanning",
        detail: {
          contentHash: row.version.contentHash,
          license: SKILL_PUBLICATION_LICENSE.id,
          ...(status.gateException ? { gateException: status.gateException } : {}),
        },
      },
      {
        id: newId("sml"),
        ...base,
        actorUserId: null,
        action: "scan",
        fromStatus: "scanning",
        toStatus: next,
        detail: { light: scan.light, findings: scan.findings.length, rulesVersion: scan.rulesVersion, contentHash: row.version.contentHash },
      },
    ]);
  });
  return { skillId, version: row.version.version, status: next, scan, slug };
}

/** The author takes a published skill out of the SkillHub. Councils keep the version they used (snapshot). */
export async function withdrawPublishedSkill(db: Database, ctx: ActorContext, skillId: string, now = new Date()) {
  assertCan(ctx.role, "project:write");
  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.organizationId, ctx.organizationId)));
  if (!row || row.ownerUserId !== ctx.userId) throw new DomainError("NOT_FOUND", "Skill not found");
  if (row.publicVersion === null) throw new DomainError("VALIDATION", "This skill is not public.", { reason: "not_public" });
  await withdrawPublicVersion(db, skillId, row.publicVersion, ctx.userId, "Withdrawn by the author", now);
}

/** Shared by the author's withdrawal and archiving: the public version becomes `withdrawn`, the skill private again. */
export async function withdrawPublicVersion(db: Database, skillId: string, version: number, actorUserId: string | null, note: string, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx
      .update(skillVersion)
      .set({ reviewStatus: "withdrawn", reviewNote: note })
      .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.version, version), eq(skillVersion.reviewStatus, "published")));
    await tx.update(skill).set({ publicVersion: null, updatedAt: now }).where(eq(skill.id, skillId));
    await tx
      .insert(skillModerationLog)
      .values({ id: newId("sml"), skillId, version, actorUserId, action: "withdraw", fromStatus: "published", toStatus: "withdrawn", detail: { note } });
  });
}

export interface SkillHubState {
  slug: string | null;
  listed: boolean;
  publicVersion: number | null;
  hidden: boolean;
  hiddenReason: string | null;
  /** Review state of every submitted version, newest first (drafts are omitted). */
  versions: Array<{
    version: number;
    status: SkillReviewStatus;
    light: string | null;
    note: string | null;
    submittedAt: Date | null;
    publishedAt: Date | null;
  }>;
}

/** The author's view of a skill's SkillHub state (status, scan light, reviewer note). */
export async function getSkillHubState(db: Database, ctx: ActorContext, skillId: string): Promise<SkillHubState> {
  assertCan(ctx.role, "project:read");
  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.organizationId, ctx.organizationId)));
  if (!row || row.ownerUserId !== ctx.userId) throw new DomainError("NOT_FOUND", "Skill not found");
  const versions = await db.select().from(skillVersion).where(eq(skillVersion.skillId, skillId)).orderBy(desc(skillVersion.version));
  return {
    slug: row.slug,
    listed: row.listed,
    publicVersion: row.publicVersion,
    hidden: Boolean(row.hiddenAt),
    hiddenReason: row.hiddenReason,
    versions: versions
      .filter((v) => v.reviewStatus !== "draft")
      .map((v) => ({
        version: v.version,
        status: v.reviewStatus,
        light: v.scanResult?.light ?? null,
        note: v.reviewNote,
        submittedAt: v.submittedAt,
        publishedAt: v.publishedAt,
      })),
  };
}

/**
 * Hub draft for kinds that mirror another workspace object (#368, expert profiles): creates the hub entry for
 * `sourceId` (version 1) or appends a new immutable version when the content changed. The caller has already checked
 * that the source (e.g. the role profile) belongs to the actor. Submitting then uses `submitSkillForPublication` with
 * the returned `skillId` – the same gate, scan, model review, queue and audit as skills.
 */
export async function saveHubDraft(
  db: Database,
  ctx: ActorContext,
  input: { kind: Exclude<HubKind, "skill">; sourceId: string; name: string; content: unknown },
): Promise<{ skillId: string; version: number; unchanged: boolean }> {
  assertCan(ctx.role, "project:write");
  const adapter = hubAdapter(input.kind);
  const checked = adapter.validate(input.content);
  if (!checked.ok) throw new DomainError("VALIDATION", checked.errors.join("; "));
  const contentHash = adapter.hash(checked.content);
  const name = input.name.trim().slice(0, 80) || adapter.display(checked.content).name;
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(skill)
      .where(and(eq(skill.kind, input.kind), eq(skill.sourceId, input.sourceId)));
    if (existing && (existing.ownerUserId !== ctx.userId || existing.organizationId !== ctx.organizationId)) throw new DomainError("NOT_FOUND", "Not found");
    if (!existing) {
      const skillId = newId("skl");
      await tx
        .insert(skill)
        .values({ id: skillId, organizationId: ctx.organizationId, ownerUserId: ctx.userId, name, kind: input.kind, sourceId: input.sourceId });
      await tx.insert(skillVersion).values({
        id: newId("skv"),
        skillId,
        organizationId: ctx.organizationId,
        version: 1,
        content: checked.content as Record<string, unknown>,
        contentHash,
        createdById: ctx.userId,
      });
      return { skillId, version: 1, unchanged: false };
    }
    const [latest] = await tx
      .select()
      .from(skillVersion)
      .where(and(eq(skillVersion.skillId, existing.id), eq(skillVersion.version, existing.latestVersion)));
    if (latest?.contentHash === contentHash) return { skillId: existing.id, version: existing.latestVersion, unchanged: true };
    const version = existing.latestVersion + 1;
    await tx.insert(skillVersion).values({
      id: newId("skv"),
      skillId: existing.id,
      organizationId: ctx.organizationId,
      version,
      content: checked.content as Record<string, unknown>,
      contentHash,
      createdById: ctx.userId,
    });
    await tx.update(skill).set({ name, latestVersion: version, archivedAt: null, updatedAt: new Date() }).where(eq(skill.id, existing.id));
    return { skillId: existing.id, version, unchanged: false };
  });
}
