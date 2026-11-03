import { assertCan, DomainError } from "@consyrion/core";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { project, projectBrief } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { assertEntitlement } from "./saas";

const githubRepoUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(value), "Must be a https://github.com/<owner>/<repo> URL");

/**
 * Serialises everything that changes or reads the source state of a council start (#181 review, TOCTOU): brief versions,
 * documents, requirement confirmations and the start itself lock the project row first, inside their transaction. Under
 * READ COMMITTED a start then either sees the change and refuses, or the change waits until the session is stored.
 */
export async function lockProjectSources(tx: Database, projectId: string): Promise<void> {
  await tx.select({ id: project.id }).from(project).where(eq(project.id, projectId)).for("update");
}

export const briefInput = z.object({
  idea: z.string().trim().min(20, "Describe the idea in at least 20 characters").max(20_000, "The idea can have at most 20,000 characters"),
  goal: z.string().trim().max(5_000, "The desired outcome can have at most 5,000 characters").default(""),
  requirements: z.string().trim().max(20_000, "Additional requirements can have at most 20,000 characters").default(""),
  repositoryUrl: githubRepoUrl.nullish(),
});

export const projectInput = z.object({
  name: z.string().trim().min(2, "Enter a project name with at least 2 characters").max(120, "The project name can have at most 120 characters"),
  type: z.enum(["idea", "architecture", "repository", "business", "technology_choice"]),
  intent: z.enum(["decision", "build", "both"]).default("decision"),
  /** "draft" saves without marking the project ready for a council. */
  status: z.enum(["draft", "ready"]).default("ready"),
  brief: briefInput,
});

export type ProjectInput = z.input<typeof projectInput>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid input", z.flattenError(parsed.error));
  return parsed.data;
}

export async function createProject(db: Database, ctx: ActorContext, input: ProjectInput) {
  assertCan(ctx.role, "project:write");
  const data = parse(projectInput, input);
  await assertEntitlement(db, ctx.organizationId, "project");
  return db.transaction(async (tx) => {
    const id = newId("prj");
    const [created] = await tx
      .insert(project)
      .values({ id, organizationId: ctx.organizationId, name: data.name, type: data.type, intent: data.intent, status: data.status, createdById: ctx.userId })
      .returning();
    await tx.insert(projectBrief).values({
      id: newId("brf"),
      organizationId: ctx.organizationId,
      projectId: id,
      version: 1,
      idea: data.brief.idea,
      goal: data.brief.goal,
      requirements: data.brief.requirements,
      repositoryUrl: data.brief.repositoryUrl ?? null,
      createdById: ctx.userId,
    });
    await recordAudit(tx, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "project.created", targetType: "project", targetId: id });
    return created!;
  });
}

export async function listProjects(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "project:read");
  return db.select().from(project).where(eq(project.organizationId, ctx.organizationId)).orderBy(desc(project.updatedAt));
}

export async function getProject(db: Database, ctx: ActorContext, projectId: string) {
  assertCan(ctx.role, "project:read");
  const [found] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, ctx.organizationId)))
    .limit(1);
  if (!found) throw new DomainError("NOT_FOUND", "Project not found");
  const [brief] = await db.select().from(projectBrief).where(eq(projectBrief.projectId, projectId)).orderBy(desc(projectBrief.version)).limit(1);
  return { ...found, brief: brief ?? null };
}

/** Appends a new brief version; earlier versions stay immutable for traceability. */
export async function updateBrief(db: Database, ctx: ActorContext, projectId: string, input: z.input<typeof briefInput>) {
  assertCan(ctx.role, "project:write");
  const data = parse(briefInput, input);
  await getProject(db, ctx, projectId);
  return db.transaction(async (tx) => {
    await lockProjectSources(tx, projectId);
    const [{ current } = { current: 0 }] = await tx
      .select({ current: max(projectBrief.version) })
      .from(projectBrief)
      .where(eq(projectBrief.projectId, projectId));
    const version = (current ?? 0) + 1;
    const [brief] = await tx
      .insert(projectBrief)
      .values({
        id: newId("brf"),
        organizationId: ctx.organizationId,
        projectId,
        version,
        idea: data.idea,
        goal: data.goal,
        requirements: data.requirements,
        repositoryUrl: data.repositoryUrl ?? null,
        createdById: ctx.userId,
      })
      .returning();
    await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, projectId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "project.brief_updated",
      targetType: "project",
      targetId: projectId,
      metadata: { version },
    });
    return brief!;
  });
}

export async function archiveProject(db: Database, ctx: ActorContext, projectId: string) {
  assertCan(ctx.role, "project:delete");
  await getProject(db, ctx, projectId);
  await db
    .update(project)
    .set({ status: "archived" })
    .where(and(eq(project.id, projectId), eq(project.organizationId, ctx.organizationId)));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "project.archived",
    targetType: "project",
    targetId: projectId,
  });
}
