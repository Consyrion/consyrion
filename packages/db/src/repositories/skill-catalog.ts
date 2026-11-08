import {
  assertCan,
  DomainError,
  OFFICIAL_SKILLS,
  scanSkillForPublication,
  SKILL_CATEGORIES,
  SKILL_PUBLICATION_LICENSE,
  SKILL_REPORT_REASONS,
  skillContentHash,
  validateSkillContent,
  type SkillContent,
  type SkillReportReason,
} from "@consyrion/core";
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { platformSetting, skill, skillModerationLog, skillPublisher, skillReport, skillVersion } from "../schema";
import { recordAudit } from "./audit";
import { createFeedback } from "./feedback";
import type { ActorContext } from "./context";
import { assertPlatformAdmin, type PlatformAdminContext } from "./feedback";
import { getPlatformSetting } from "./platform-settings";
import { createSkill } from "./skills";

/**
 * Public SkillHub catalog (#368 PR 6). Read without login: only versions an admin (or the opt-in auto-approval)
 * published, never hidden, archived or of a suspended publisher. Nothing tenant-private is returned – a public skill is
 * deliberately shared by its author under CC BY 4.0. Adopting creates the caller's own private copy (with origin);
 * reports go to the admin queue and never hide a skill on their own.
 */

export interface PublicSkillSummary {
  handle: string;
  slug: string;
  name: string;
  summary: string;
  category: string;
  version: number;
  publishedAt: Date | null;
}

export interface PublicSkill extends PublicSkillSummary {
  skillId: string;
  content: SkillContent;
  changelog: string | null;
  contentHash: string;
  license: string;
  listed: boolean;
  /** Other workspaces that adopted it (only on the detail lookup). */
  uses?: number;
}

const visible = and(isNotNull(skill.publicVersion), isNull(skill.hiddenAt), isNull(skill.archivedAt), isNull(skillPublisher.suspendedAt));

function base(db: Database) {
  return db
    .select({ skill, version: skillVersion, handle: skillPublisher.handle })
    .from(skill)
    .innerJoin(skillPublisher, eq(skillPublisher.userId, skill.ownerUserId))
    .innerJoin(
      skillVersion,
      and(eq(skillVersion.skillId, skill.id), eq(skillVersion.version, skill.publicVersion), eq(skillVersion.reviewStatus, "published")),
    );
}

function toPublic(row: { skill: typeof skill.$inferSelect; version: typeof skillVersion.$inferSelect; handle: string }): PublicSkill | null {
  const checked = validateSkillContent(row.version.content);
  if (!checked.ok || !row.skill.slug) return null;
  return {
    skillId: row.skill.id,
    handle: row.handle,
    slug: row.skill.slug,
    name: checked.content.name,
    summary: checked.content.summary,
    category: checked.content.category,
    version: row.version.version,
    publishedAt: row.version.publishedAt,
    content: checked.content,
    changelog: row.version.changelog,
    contentHash: row.version.contentHash,
    license: row.version.license ?? SKILL_PUBLICATION_LICENSE.id,
    listed: row.skill.listed,
  };
}

/**
 * Official skills (#368 PR 7): shipped with CONSYRION AI under the reserved handle @consyrion, so the catalog is never
 * empty. They come from the reviewed repository (no database row, no fake user), must pass the publication scan green
 * (enforced by a test) and can be hidden by a platform admin at runtime (platform setting, audited) and reported.
 */
export const OFFICIAL_SKILL_HANDLE = "consyrion";
export const SKILLHUB_OFFICIAL_SETTING = "skillhub_official";

async function hiddenOfficialSlugs(db: Database): Promise<Set<string>> {
  const value = (await getPlatformSetting<{ hidden?: unknown }>(db, SKILLHUB_OFFICIAL_SETTING))?.value;
  return new Set(Array.isArray(value?.hidden) ? value.hidden.filter((s): s is string => typeof s === "string") : []);
}

function officialPublic(o: (typeof OFFICIAL_SKILLS)[number]): PublicSkill | null {
  if (scanSkillForPublication(o.content).light !== "green") return null;
  return {
    skillId: `official:${o.slug}`,
    handle: OFFICIAL_SKILL_HANDLE,
    slug: o.slug,
    name: o.content.name,
    summary: o.content.summary,
    category: o.content.category,
    version: o.version,
    publishedAt: null,
    content: o.content,
    changelog: null,
    contentHash: skillContentHash(o.content),
    license: SKILL_PUBLICATION_LICENSE.id,
    listed: true,
  };
}

async function officialSkills(db: Database): Promise<PublicSkill[]> {
  const hidden = await hiddenOfficialSlugs(db);
  return OFFICIAL_SKILLS.filter((o) => !hidden.has(o.slug))
    .map(officialPublic)
    .filter((s): s is PublicSkill => s !== null);
}

/** The public catalog: listed skills only, newest first, optional text search and category. */
export async function listPublicSkills(
  db: Database,
  filter: { q?: string | null; category?: string | null; limit?: number; offset?: number } = {},
): Promise<PublicSkillSummary[]> {
  const q = (filter.q ?? "").trim().slice(0, 100);
  const category = SKILL_CATEGORIES.includes(filter.category as never) ? filter.category : null;
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await base(db)
    .where(
      and(
        visible,
        eq(skill.listed, true),
        q ? or(ilike(skill.name, like), ilike(skillPublisher.handle, like), sql`${skillVersion.content}->>'summary' ilike ${like}`) : undefined,
        category ? sql`${skillVersion.content}->>'category' = ${category}` : undefined,
      ),
    )
    .orderBy(desc(skillVersion.publishedAt))
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 100))
    .offset(Math.max(filter.offset ?? 0, 0));
  const needle = q.toLowerCase();
  const official =
    (filter.offset ?? 0) > 0
      ? []
      : (await officialSkills(db)).filter(
          (o) =>
            (!category || o.category === category) &&
            (!needle || o.name.toLowerCase().includes(needle) || o.summary.toLowerCase().includes(needle) || OFFICIAL_SKILL_HANDLE.includes(needle)),
        );
  return [...official, ...rows.map(toPublic).filter((s): s is PublicSkill => s !== null)].map(
    ({ handle, slug, name, summary, category, version, publishedAt }) => ({
      handle,
      slug,
      name,
      summary,
      category,
      version,
      publishedAt,
    }),
  );
}

/** One public skill by `@handle/slug` (unlisted ones too – by link). Null when it is not public. */
/**
 * How many other workspaces adopted a public skill (copies that name it as origin). The author's own workspace never
 * counts, and each workspace counts once – a counter that self-adoption or repeated clicks cannot inflate.
 */
export async function countSkillAdoptions(db: Database, skillId: string, ownerOrganizationId: string | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${skill.organizationId})` })
    .from(skill)
    .where(and(sql`${skill.forkedFrom}->>'skillId' = ${skillId}`, ownerOrganizationId ? sql`${skill.organizationId} <> ${ownerOrganizationId}` : undefined));
  return Number(row?.n ?? 0);
}

export async function getPublicSkill(db: Database, handle: string, slug: string): Promise<PublicSkill | null> {
  const h = handle.replace(/^@/, "").trim().toLowerCase();
  const s = slug.trim().toLowerCase();
  if (!h || !s) return null;
  if (h === OFFICIAL_SKILL_HANDLE) {
    const official = (await officialSkills(db)).find((o) => o.slug === s);
    return official ? { ...official, uses: await countSkillAdoptions(db, official.skillId, null) } : null;
  }
  const [row] = await base(db).where(and(visible, eq(skillPublisher.handle, h), eq(skill.slug, s)));
  const found = row ? toPublic(row) : null;
  return found ? { ...found, uses: await countSkillAdoptions(db, found.skillId, row!.skill.organizationId) } : null;
}

/** Copies the public version into the caller's workspace as a private skill that names its origin. */
export async function adoptPublicSkill(db: Database, ctx: ActorContext, handle: string, slug: string) {
  assertCan(ctx.role, "project:write");
  const found = await getPublicSkill(db, handle, slug);
  if (!found) throw new DomainError("NOT_FOUND", "Skill not found");
  return createSkill(db, ctx, {
    content: found.content,
    forkedFrom: { skillId: found.skillId, name: `@${found.handle}/${found.slug}`, version: found.version, contentHash: found.contentHash },
  });
}

/** A signed-in user reports a public skill (once per skill). Goes to the admin queue only. */
export async function reportPublicSkill(db: Database, ctx: ActorContext, input: { handle: string; slug: string; reason: unknown; note?: unknown }) {
  assertCan(ctx.role, "project:read");
  if (!SKILL_REPORT_REASONS.includes(input.reason as SkillReportReason)) throw new DomainError("VALIDATION", "Choose a reason.", { reason: "reason_missing" });
  const found = await getPublicSkill(db, input.handle, input.slug);
  if (!found) throw new DomainError("NOT_FOUND", "Skill not found");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1_000) : null;
  if (found.handle === OFFICIAL_SKILL_HANDLE) {
    // Official skills have no database row: their reports go to the platform admins' feedback inbox.
    await createFeedback(
      db,
      { kind: "user", actor: ctx },
      {
        kind: "bug",
        subject: `SkillHub report: @${found.handle}/${found.slug} (${String(input.reason)})`.slice(0, 120),
        text: note || `Reason: ${String(input.reason)}`,
      },
    );
    return;
  }
  const [existing] = await db
    .select({ id: skillReport.id })
    .from(skillReport)
    .where(and(eq(skillReport.skillId, found.skillId), eq(skillReport.reporterUserId, ctx.userId)));
  if (existing) throw new DomainError("VALIDATION", "You already reported this skill.", { reason: "already_reported" });
  await db.transaction(async (tx) => {
    await tx.insert(skillReport).values({
      id: newId("skr"),
      skillId: found.skillId,
      version: found.version,
      reporterUserId: ctx.userId,
      reason: input.reason as SkillReportReason,
      note: note || null,
    });
    await tx.insert(skillModerationLog).values({
      id: newId("sml"),
      skillId: found.skillId,
      version: found.version,
      actorUserId: ctx.userId,
      action: "report",
      detail: { reason: input.reason },
    });
  });
}

export interface OpenSkillReport {
  id: string;
  skillId: string;
  name: string;
  handle: string | null;
  slug: string | null;
  version: number;
  reason: SkillReportReason;
  note: string | null;
  createdAt: Date;
  /** Open reports on the same skill – a signal for the admin, never an automatic action. */
  openOnSkill: number;
}

/** Open reports for the admin queue, oldest first. */
export async function listOpenSkillReports(db: Database, admin: PlatformAdminContext): Promise<OpenSkillReport[]> {
  assertPlatformAdmin(admin);
  const rows = await db
    .select({ report: skillReport, name: skill.name, slug: skill.slug, handle: skillPublisher.handle })
    .from(skillReport)
    .innerJoin(skill, eq(skill.id, skillReport.skillId))
    .leftJoin(skillPublisher, eq(skillPublisher.userId, skill.ownerUserId))
    .where(eq(skillReport.status, "open"))
    .orderBy(skillReport.createdAt);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.report.skillId, (counts.get(r.report.skillId) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.report.id,
    skillId: r.report.skillId,
    name: r.name,
    handle: r.handle,
    slug: r.slug,
    version: r.report.version,
    reason: r.report.reason,
    note: r.report.note,
    createdAt: r.report.createdAt,
    openOnSkill: counts.get(r.report.skillId) ?? 1,
  }));
}

/** Closes a report as resolved (action taken) or dismissed. Hiding is a separate, explicit admin action. */
export async function resolveSkillReport(db: Database, admin: PlatformAdminContext, reportId: string, status: "resolved" | "dismissed", now = new Date()) {
  assertPlatformAdmin(admin);
  if (status !== "resolved" && status !== "dismissed") throw new DomainError("VALIDATION", "Invalid status");
  const [report] = await db.select().from(skillReport).where(eq(skillReport.id, reportId));
  if (!report) throw new DomainError("NOT_FOUND", "Report not found");
  await db.transaction(async (tx) => {
    await tx.update(skillReport).set({ status, resolvedById: admin.userId, resolvedAt: now }).where(eq(skillReport.id, reportId));
    await tx.insert(skillModerationLog).values({
      id: newId("sml"),
      skillId: report.skillId,
      version: report.version,
      actorUserId: admin.userId,
      action: "report_resolved",
      detail: { reportId, status, reason: report.reason },
    });
  });
}

/** Official skills with their runtime visibility, for the admin card. */
export async function listOfficialSkillsForAdmin(db: Database, admin: PlatformAdminContext) {
  assertPlatformAdmin(admin);
  const hidden = await hiddenOfficialSlugs(db);
  return OFFICIAL_SKILLS.map((o) => ({
    slug: o.slug,
    name: o.content.name,
    version: o.version,
    contentHash: skillContentHash(o.content),
    scanLight: scanSkillForPublication(o.content).light,
    hidden: hidden.has(o.slug),
  }));
}

/** Hides or shows an official skill in the public catalog without a deploy. Audited. */
export async function setOfficialSkillHidden(db: Database, admin: PlatformAdminContext, slug: string, hidden: boolean) {
  assertPlatformAdmin(admin);
  if (!OFFICIAL_SKILLS.some((o) => o.slug === slug)) throw new DomainError("NOT_FOUND", "Skill not found");
  const current = await hiddenOfficialSlugs(db);
  if (hidden) current.add(slug);
  else current.delete(slug);
  const value = { hidden: [...current].sort() };
  await db
    .insert(platformSetting)
    .values({ key: SKILLHUB_OFFICIAL_SETTING, value, updatedBy: admin.userId })
    .onConflictDoUpdate({ target: platformSetting.key, set: { value, updatedBy: admin.userId, updatedAt: new Date() } });
  await recordAudit(db, {
    organizationId: null,
    actorUserId: admin.userId,
    action: hidden ? "skillhub.official_hidden" : "skillhub.official_shown",
    targetType: "skill",
    targetId: `official:${slug}`,
  });
}
