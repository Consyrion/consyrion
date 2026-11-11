import { assertCan, DomainError, redactSecrets } from "@consyrium/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import * as s from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { getPlatformSetting } from "./platform-settings";

/**
 * Demo project (owner decision 08.11.26): every customer workspace gets one read-only copy of a finished council, so a
 * new customer sees what a decision looks like before spending a token. A platform admin picks the template session
 * per interface language (platform setting `demo.templates`); the copy is made once per workspace
 * (`organization.demo_seeded_at`), so a deleted demo never comes back. No keys, documents, usage, approvals or builds
 * are copied, and the demo project neither counts against the plan nor accepts councils, approvals or builds.
 */
export const DEMO_SETTING_KEY = "demo.templates";
export type DemoTemplates = Partial<Record<string, string>>;

/** Tables of one council, in foreign-key order. `by` is the column that links a row to the copied set. */
const SESSION_TABLES = [
  [s.councilParticipant, "sessionId"],
  [s.councilRoleAssignment, "sessionId"],
  [s.workflowStage, "sessionId"],
  [s.proposal, "sessionId"],
  [s.proposalRevision, "proposalId"],
  [s.debateMessage, "sessionId"],
  [s.minorityObjection, "sessionId"],
  [s.minorityReview, "sessionId"],
  [s.consensusResult, "sessionId"],
  [s.evaluationRound, "sessionId"],
  [s.requirementCheck, "sessionId"],
  [s.evaluationScore, "sessionId"],
  [s.vote, "sessionId"],
  [s.finalDecision, "sessionId"],
] as const;

type Row = Record<string, unknown>;

/** User references in the copied tables; all point to the workspace owner who receives the demo. */
const USER_COLUMNS = ["createdById", "confirmedById", "userId", "ownerUserId", "actorUserId", "planApprovedById"] as const;
/** Columns ending in "Id" that are not references to rows (model names, requirement keys like "R1"). */
const NOT_REFERENCES = new Set(["organizationId", "modelId", "requirementId", "providerId", "credentialId", "planId"]);

/** Replaces every copied id inside a value (also inside jsonb such as the verdict matrix); dates stay dates. */
function remap(value: unknown, ids: Map<string, string>, pattern: RegExp | null): unknown {
  if (typeof value === "string") return pattern ? value.replace(pattern, (id) => ids.get(id) ?? id) : value;
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids, pattern));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids, pattern)]));
}

const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Copies a finished council of any workspace into `ctx`'s workspace as a read-only demo project. */
export async function copySessionAsDemo(db: Database, ctx: ActorContext, templateSessionId: string): Promise<{ projectId: string; sessionId: string }> {
  const [session] = await db.select().from(s.councilSession).where(eq(s.councilSession.id, templateSessionId));
  if (!session) throw new DomainError("NOT_FOUND", "Demo template session not found");
  const [decision] = await db.select({ id: s.finalDecision.id }).from(s.finalDecision).where(eq(s.finalDecision.sessionId, session.id));
  if (!decision) throw new DomainError("VALIDATION", "The demo template must be a finished council with a verdict");
  const [project] = await db.select().from(s.project).where(eq(s.project.id, session.projectId));
  const rows: Array<[unknown, Row[]]> = [];
  const proposalIds: string[] = [];
  for (const [table, by] of SESSION_TABLES) {
    const column = (table as unknown as Record<string, unknown>)[by] as never;
    const key = by === "proposalId" ? proposalIds : [session.id];
    const found = key.length
      ? ((await db
          .select()
          .from(table as never)
          .where(inArray(column, key))) as Row[])
      : [];
    found.sort((a, b) => +(a.createdAt as Date) - +(b.createdAt as Date));
    if (table === s.proposal) proposalIds.push(...found.map((r) => r.id as string));
    rows.push([table, found]);
  }

  // Every requirement list version the council refers to (session, rounds, verdict) and the briefs behind them.
  const listIds = new Set<string>([session.requirementListId].filter((x): x is string => Boolean(x)));
  for (const [, found] of rows) for (const r of found) if (typeof r.requirementListId === "string") listIds.add(r.requirementListId);
  const lists = listIds.size
    ? await db
        .select()
        .from(s.requirementList)
        .where(inArray(s.requirementList.id, [...listIds]))
    : [];
  const briefIds = [...new Set([session.briefId, ...lists.map((l) => l.briefId)])];
  const briefs = await db.select().from(s.projectBrief).where(inArray(s.projectBrief.id, briefIds));

  const ids = new Map<string, string>();
  const fresh = (id: string) => {
    const prefix = id.includes("_") ? id.slice(0, id.indexOf("_")) : "demo";
    ids.set(id, newId(prefix as never));
  };
  fresh(project!.id);
  fresh(session.id);
  for (const l of lists) fresh(l.id);
  for (const b of briefs) fresh(b.id);
  // minority_review and consensus_result are keyed by sessionId and have no id of their own.
  for (const [, found] of rows) for (const r of found) if (typeof r.id === "string") fresh(r.id);
  const pattern = ids.size ? new RegExp([...ids.keys()].map(escape).join("|"), "g") : null;

  const copied = new Set(ids.values());
  const own = (row: Row): Row => {
    const out = remap(row, ids, pattern) as Row;
    out.organizationId = ctx.organizationId;
    for (const k of USER_COLUMNS) if (typeof out[k] === "string") out[k] = ctx.userId;
    if ("credentialId" in out) out.credentialId = null;
    if ("planId" in out) out.planId = null;
    // Review of #374: no reference may point back into the template workspace – every *Id is null, the new
    // owner or a copied row; otherwise the copy stops instead of linking across workspaces.
    for (const [k, v] of Object.entries(out)) {
      if (!k.endsWith("Id") || NOT_REFERENCES.has(k) || typeof v !== "string") continue;
      if (!copied.has(v) && v !== ctx.userId) throw new DomainError("VALIDATION", `Demo template refers to data outside the council (${k})`);
    }
    return out;
  };

  const projectId = ids.get(project!.id)!;
  const sessionId = ids.get(session.id)!;
  await db.transaction(async (tx) => {
    await tx.insert(s.project).values({
      ...(own(project as unknown as Row) as typeof s.project.$inferInsert),
      name: `Demo: ${project!.name}`,
      status: "ready",
      isDemo: true,
      githubIntegrationId: null,
      repositoryFullName: null,
      repositoryDefaultBranch: null,
      deliveryDefault: null,
    });
    for (const b of briefs) await tx.insert(s.projectBrief).values(own(b as unknown as Row) as typeof s.projectBrief.$inferInsert);
    for (const l of lists)
      await tx.insert(s.requirementList).values({
        ...(own(l as unknown as Row) as typeof s.requirementList.$inferInsert),
        // Document names and hashes of the template stay with the template.
        sourceState: { ...l.sourceState, briefId: ids.get(l.sourceState.briefId) ?? l.sourceState.briefId, documents: [] },
      });
    // The session's skill snapshot (possibly a private team skill with its knowledge text) and errors stay behind.
    await tx
      .insert(s.councilSession)
      .values({ ...(own(session as unknown as Row) as typeof s.councilSession.$inferInsert), documentIds: [], skill: null, error: null });
    for (const [table, found] of rows) for (const r of found) await tx.insert(table as never).values(own(r) as never);
  });
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "demo.created", targetType: "project", targetId: projectId });
  return { projectId, sessionId };
}

/**
 * Once per workspace: copies the demo template of `locale` (fallback English, then German). Returns null when the
 * workspace already had its demo, when no template is set, or when the copy fails (the app never breaks over a demo).
 */
export async function ensureDemoProject(db: Database, ctx: ActorContext, locale: string): Promise<string | null> {
  const [org] = await db.select({ seeded: s.organization.demoSeededAt }).from(s.organization).where(eq(s.organization.id, ctx.organizationId));
  if (!org || org.seeded) return null;
  const templates = (await getPlatformSetting<DemoTemplates>(db, DEMO_SETTING_KEY))?.value ?? {};
  const template = templates[locale] ?? templates.en ?? templates.de;
  if (!template) return null;
  // Claim first, so two parallel page loads never copy twice.
  const claimed = await db
    .update(s.organization)
    .set({ demoSeededAt: new Date() })
    .where(and(eq(s.organization.id, ctx.organizationId), isNull(s.organization.demoSeededAt)))
    .returning({ id: s.organization.id });
  if (!claimed.length) return null;
  try {
    return (await copySessionAsDemo(db, ctx, template)).projectId;
  } catch (err) {
    await db.update(s.organization).set({ demoSeededAt: null }).where(eq(s.organization.id, ctx.organizationId));
    console.error("[demo] copy failed", redactSecrets(err instanceof Error ? err.message : String(err)));
    return null;
  }
}

/** Guards: the demo project is read-only. */
export async function assertNotDemoProject(db: Database, ctx: ActorContext, projectId: string) {
  const [row] = await db
    .select({ isDemo: s.project.isDemo })
    .from(s.project)
    .where(and(eq(s.project.id, projectId), eq(s.project.organizationId, ctx.organizationId)));
  if (row?.isDemo) throw new DomainError("VALIDATION", "This is the demo project – create your own project to start a council");
}

export async function assertNotDemoSession(db: Database, ctx: ActorContext, sessionId: string) {
  const [row] = await db
    .select({ isDemo: s.project.isDemo })
    .from(s.councilSession)
    .innerJoin(s.project, eq(s.project.id, s.councilSession.projectId))
    .where(and(eq(s.councilSession.id, sessionId), eq(s.councilSession.organizationId, ctx.organizationId)));
  if (row?.isDemo) throw new DomainError("VALIDATION", "This is the demo project – approvals and builds need your own project");
}

/** Admin: finished councils of the admin's own workspace that can serve as a demo template. */
export async function listDemoCandidates(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:manage");
  return db
    .select({ sessionId: s.councilSession.id, projectName: s.project.name, createdAt: s.councilSession.createdAt })
    .from(s.councilSession)
    .innerJoin(s.project, eq(s.project.id, s.councilSession.projectId))
    .innerJoin(s.finalDecision, eq(s.finalDecision.sessionId, s.councilSession.id))
    .where(and(eq(s.councilSession.organizationId, ctx.organizationId), eq(s.project.isDemo, false)))
    .orderBy(asc(s.councilSession.createdAt));
}

/** Admin: sets (or with null clears) the demo template of one interface language. Only own finished councils. */
export async function setDemoTemplate(db: Database, ctx: ActorContext, locale: string, sessionId: string | null) {
  if (!/^[a-z]{2}$/.test(locale)) throw new DomainError("VALIDATION", "Unknown language");
  if (sessionId && !(await listDemoCandidates(db, ctx)).some((c) => c.sessionId === sessionId))
    throw new DomainError("VALIDATION", "Pick a finished council of your own workspace");
  const current = (await getPlatformSetting<DemoTemplates>(db, DEMO_SETTING_KEY))?.value ?? {};
  const value: DemoTemplates = { ...current };
  if (sessionId) value[locale] = sessionId;
  else delete value[locale];
  await db
    .insert(s.platformSetting)
    .values({ key: DEMO_SETTING_KEY, value, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: s.platformSetting.key, set: { value, updatedBy: ctx.userId, updatedAt: new Date() } });
  await recordAudit(db, {
    organizationId: null,
    actorUserId: ctx.userId,
    action: "admin.setting_updated",
    targetType: "platform_setting",
    targetId: DEMO_SETTING_KEY,
  });
  return value;
}

export async function getDemoTemplates(db: Database): Promise<DemoTemplates> {
  return (await getPlatformSetting<DemoTemplates>(db, DEMO_SETTING_KEY))?.value ?? {};
}
