import {
  assertCan,
  DomainError,
  isUnlimited,
  OFFICIAL_SKILLS,
  officialSkill,
  SKILL_LIMITS,
  skillContentHash,
  validateSkillChangelog,
  validateSkillContent,
  type SkillContent,
  type SkillForkRef,
  type SkillSessionRef,
  type SkillReviewStatus,
  type SkillVisibility,
} from "@consyrion/core";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { skill, skillVersion } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { getEntitlements } from "./saas";
import { withdrawPublicVersion } from "./skill-hub";

/**
 * Skills (#363): decision packages that pre-fill a council setup. Visibility per skill: "private" (only the author) or
 * "team" (every member of the workspace). Shipped skills (`official:<slug>`) are read-only and visible to everyone.
 * Content is validated and scanned (secrets, personal data, rule-override text) on every save; versions are immutable.
 */

export interface SkillSummary {
  id: string;
  name: string;
  summary: string;
  category: string;
  visibility: SkillVisibility | "official";
  version: number;
  contentHash: string;
  /** Whether the caller may change it (author of an own skill). */
  editable: boolean;
  ownerUserId: string | null;
  updatedAt: Date | null;
  /** Source of a duplicated skill (#422). */
  forkedFrom: SkillForkRef | null;
  /** SkillHub (#368): public version and the review state of the latest version; null for official skills. */
  hub: { publicVersion: number | null; latestStatus: SkillReviewStatus; hidden: boolean } | null;
}

function checkedChangelog(input: unknown): string | null {
  const result = validateSkillChangelog(input);
  if (!result.ok) throw new DomainError("VALIDATION", result.error);
  return result.changelog;
}

const visibleTo = (ctx: ActorContext) =>
  and(eq(skill.organizationId, ctx.organizationId), isNull(skill.archivedAt), or(eq(skill.visibility, "team"), eq(skill.ownerUserId, ctx.userId)));

/**
 * Validated content plus the input fields that were not stored (#419). A skill of a newer schema is refused with
 * `details.reason = "newer_schema"` so the UI can say "update CONSYRION" in the user's language.
 */
function checked(input: unknown): { content: SkillContent; ignoredFields: string[] } {
  const result = validateSkillContent(input);
  if (!result.ok)
    throw new DomainError(
      "VALIDATION",
      result.errors.join("; "),
      result.newerSchemaVersion !== undefined ? { reason: "newer_schema", schemaVersion: result.newerSchemaVersion } : undefined,
    );
  return { content: result.content, ignoredFields: result.ignoredFields };
}

/** Official skills plus the workspace's skills the caller may see (own private ones and all team ones). */
export async function listSkills(db: Database, ctx: ActorContext): Promise<SkillSummary[]> {
  assertCan(ctx.role, "project:read");
  const rows = await db
    .select({ skill, version: skillVersion })
    .from(skill)
    .innerJoin(skillVersion, and(eq(skillVersion.skillId, skill.id), eq(skillVersion.version, skill.latestVersion)))
    .where(visibleTo(ctx))
    .orderBy(desc(skill.updatedAt));
  const official: SkillSummary[] = OFFICIAL_SKILLS.map((o) => ({
    id: `official:${o.slug}`,
    name: o.content.name,
    summary: o.content.summary,
    category: o.content.category,
    visibility: "official",
    version: o.version,
    contentHash: skillContentHash(o.content),
    editable: false,
    ownerUserId: null,
    updatedAt: null,
    forkedFrom: null,
    hub: null,
  }));
  return [
    ...rows.map(({ skill: s, version: v }) => {
      const content = v.content as unknown as SkillContent;
      return {
        id: s.id,
        name: s.name,
        summary: content.summary,
        category: content.category,
        visibility: s.visibility,
        version: v.version,
        contentHash: v.contentHash,
        editable: s.ownerUserId === ctx.userId,
        ownerUserId: s.ownerUserId,
        updatedAt: s.updatedAt,
        forkedFrom: s.forkedFrom ?? null,
        hub: { publicVersion: s.publicVersion, latestStatus: v.reviewStatus, hidden: Boolean(s.hiddenAt) },
      };
    }),
    ...official,
  ];
}

/**
 * A skill version for use (council setup, MCP, export): the latest one unless `version` is given. Refused unless the
 * caller may see the skill. Returns the content and the reference a council session stores.
 */
export async function getSkillForUse(
  db: Database,
  ctx: ActorContext,
  skillId: string,
  version?: number,
  options: { allowArchived?: boolean } = {},
): Promise<{
  ref: SkillSessionRef;
  content: SkillContent;
  visibility: SkillVisibility | "official";
  editable: boolean;
  forkedFrom: SkillForkRef | null;
  changelog: string | null;
}> {
  assertCan(ctx.role, "project:read");
  const official = officialSkill(skillId);
  if (official) {
    if (version !== undefined && version !== official.version) throw new DomainError("NOT_FOUND", "Skill version not found");
    return {
      ref: { skillId, name: official.content.name, version: official.version, contentHash: skillContentHash(official.content) },
      content: official.content,
      visibility: "official",
      editable: false,
      forkedFrom: null,
      changelog: null,
    };
  }
  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.organizationId, ctx.organizationId), or(eq(skill.visibility, "team"), eq(skill.ownerUserId, ctx.userId))));
  if (!row) throw new DomainError("NOT_FOUND", "Skill not found");
  // An archived skill is no longer listed and cannot pre-fill a new council. Only callers that read the version an
  // existing council already pinned (report, session view) pass allowArchived.
  if (row.archivedAt && !options.allowArchived) throw new DomainError("NOT_FOUND", "Skill not found");
  const [v] = await db
    .select()
    .from(skillVersion)
    .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.version, version ?? row.latestVersion)));
  if (!v) throw new DomainError("NOT_FOUND", "Skill version not found");
  return {
    ref: { skillId, name: row.name, version: v.version, contentHash: v.contentHash },
    content: v.content as unknown as SkillContent,
    visibility: row.visibility,
    editable: row.ownerUserId === ctx.userId,
    forkedFrom: row.forkedFrom ?? null,
    changelog: v.changelog ?? null,
  };
}

/** Version list of a visible skill (#422), newest first, with the optional changelog of each version. */
export async function listSkillVersions(
  db: Database,
  ctx: ActorContext,
  skillId: string,
): Promise<Array<{ version: number; contentHash: string; changelog: string | null; createdAt: Date | null }>> {
  const current = await getSkillForUse(db, ctx, skillId); // visibility check (also for official skills)
  if (current.visibility === "official") return [{ version: current.ref.version, contentHash: current.ref.contentHash, changelog: null, createdAt: null }];
  const rows = await db
    .select({ version: skillVersion.version, contentHash: skillVersion.contentHash, changelog: skillVersion.changelog, createdAt: skillVersion.createdAt })
    .from(skillVersion)
    .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.organizationId, ctx.organizationId)))
    .orderBy(desc(skillVersion.version));
  return rows;
}

async function assertCanKeepAnother(db: Database, ctx: ActorContext) {
  const { plan, entitlements } = await getEntitlements(db, ctx.organizationId);
  if (isUnlimited(entitlements.maxSkills)) return;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(skill)
    .where(and(eq(skill.organizationId, ctx.organizationId), isNull(skill.archivedAt)));
  if ((count?.n ?? 0) >= entitlements.maxSkills)
    throw new DomainError("FORBIDDEN", `Your plan allows ${entitlements.maxSkills} own skill(s) (plan: ${plan}). Upgrade under Settings → Billing.`);
}

async function assertTeamSharing(db: Database, ctx: ActorContext) {
  const { plan, entitlements } = await getEntitlements(db, ctx.organizationId);
  if (!entitlements.teamSkills)
    throw new DomainError("FORBIDDEN", `Sharing skills with the team is included in Pro (plan: ${plan}). Upgrade under Settings → Billing.`);
}

/** Creates a skill (version 1). New skills are private unless `visibility: "team"` is asked for and allowed. */
export async function createSkill(
  db: Database,
  ctx: ActorContext,
  input: { content: unknown; visibility?: SkillVisibility; changelog?: unknown; forkedFrom?: SkillForkRef },
) {
  assertCan(ctx.role, "project:write");
  const { content, ignoredFields } = checked(input.content);
  const changelog = checkedChangelog(input.changelog);
  const visibility = input.visibility ?? "private";
  await assertCanKeepAnother(db, ctx);
  if (visibility === "team") await assertTeamSharing(db, ctx);
  const id = newId("skl");
  const contentHash = skillContentHash(content);
  await db.transaction(async (tx) => {
    await tx.insert(skill).values({
      id,
      organizationId: ctx.organizationId,
      ownerUserId: ctx.userId,
      name: content.name,
      visibility,
      latestVersion: 1,
      forkedFrom: input.forkedFrom ?? null,
    });
    await tx.insert(skillVersion).values({
      id: newId("skv"),
      skillId: id,
      organizationId: ctx.organizationId,
      version: 1,
      content: content as unknown as Record<string, unknown>,
      contentHash,
      changelog,
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.forkedFrom ? "skill.duplicated" : "skill.created",
      targetType: "skill",
      targetId: id,
      metadata: input.forkedFrom
        ? { visibility, contentHash, forkedFrom: { skillId: input.forkedFrom.skillId, version: input.forkedFrom.version } }
        : { visibility, contentHash },
    });
  });
  return { id, version: 1, contentHash, ignoredFields, forkedFrom: input.forkedFrom ?? null };
}

/**
 * One-click copy of an official or visible team skill (#422): a new private skill of the caller with the same content
 * (optionally renamed) and `forkedFrom` = source id, version and content hash. Counts towards the plan limit.
 */
export async function duplicateSkill(db: Database, ctx: ActorContext, sourceId: string, input: { name?: unknown } = {}) {
  assertCan(ctx.role, "project:write");
  const source = await getSkillForUse(db, ctx, sourceId);
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, SKILL_LIMITS.name) : source.content.name;
  return createSkill(db, ctx, {
    content: { ...source.content, name },
    forkedFrom: { skillId: source.ref.skillId, name: source.ref.name, version: source.ref.version, contentHash: source.ref.contentHash },
  });
}

async function ownSkill(db: Database, ctx: ActorContext, skillId: string) {
  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.organizationId, ctx.organizationId), isNull(skill.archivedAt)));
  // Same answer for "not there" and "not yours": a private skill of someone else is invisible.
  if (!row || (row.ownerUserId !== ctx.userId && row.visibility !== "team")) throw new DomainError("NOT_FOUND", "Skill not found");
  if (row.ownerUserId !== ctx.userId) throw new DomainError("FORBIDDEN", "Only the author can change this skill");
  return row;
}

/** Saves changed content as a new immutable version (author only). Identical content creates no version. */
export async function saveSkillVersion(db: Database, ctx: ActorContext, skillId: string, input: { content: unknown; changelog?: unknown }) {
  assertCan(ctx.role, "project:write");
  if (officialSkill(skillId)) throw new DomainError("FORBIDDEN", "Official skills are read-only; duplicate it to change a copy");
  const row = await ownSkill(db, ctx, skillId);
  const { content, ignoredFields } = checked(input.content);
  const changelog = checkedChangelog(input.changelog);
  const contentHash = skillContentHash(content);
  const [latest] = await db
    .select()
    .from(skillVersion)
    .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.version, row.latestVersion)));
  if (latest?.contentHash === contentHash) return { id: skillId, version: row.latestVersion, contentHash, unchanged: true, ignoredFields };
  const version = row.latestVersion + 1;
  await db.transaction(async (tx) => {
    await tx.insert(skillVersion).values({
      id: newId("skv"),
      skillId,
      organizationId: ctx.organizationId,
      version,
      content: content as unknown as Record<string, unknown>,
      contentHash,
      changelog,
      createdById: ctx.userId,
    });
    await tx.update(skill).set({ name: content.name, latestVersion: version }).where(eq(skill.id, skillId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "skill.version_saved",
      targetType: "skill",
      targetId: skillId,
      metadata: { version, contentHash },
    });
  });
  return { id: skillId, version, contentHash, unchanged: false, ignoredFields };
}

/** Private ↔ team (author only; team sharing needs the plan entitlement). */
export async function setSkillVisibility(db: Database, ctx: ActorContext, skillId: string, visibility: SkillVisibility) {
  assertCan(ctx.role, "project:write");
  if (visibility !== "private" && visibility !== "team") throw new DomainError("VALIDATION", "visibility must be private or team");
  const row = await ownSkill(db, ctx, skillId);
  if (visibility === "team" && row.visibility !== "team") await assertTeamSharing(db, ctx);
  await db.update(skill).set({ visibility }).where(eq(skill.id, skillId));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "skill.visibility_changed",
    targetType: "skill",
    targetId: skillId,
    metadata: { visibility },
  });
}

/** Archives a skill (author only): no longer offered, versions stay for the councils that used them. */
export async function archiveSkill(db: Database, ctx: ActorContext, skillId: string) {
  assertCan(ctx.role, "project:write");
  const own = await ownSkill(db, ctx, skillId);
  // An archived skill leaves the SkillHub too (#368); councils keep the version they used.
  if (own.publicVersion !== null) await withdrawPublicVersion(db, skillId, own.publicVersion, ctx.userId, "Archived by the author");
  await db.update(skill).set({ archivedAt: new Date() }).where(eq(skill.id, skillId));
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "skill.archived", targetType: "skill", targetId: skillId });
}
