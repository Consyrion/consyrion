import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { githubIntegration, project } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { assertEntitlement } from "./saas";

export async function saveGitHubInstallation(
  db: Database,
  ctx: ActorContext,
  data: { installationId: number; accountLogin: string; accountType: string; repositorySelection: string },
) {
  assertCan(ctx.role, "org:manage");
  const [existing] = await db
    .select()
    .from(githubIntegration)
    .where(and(eq(githubIntegration.organizationId, ctx.organizationId), eq(githubIntegration.installationId, data.installationId)));
  if (existing) {
    await db.update(githubIntegration).set({ ...data, suspendedAt: null }).where(eq(githubIntegration.id, existing.id));
    return existing.id;
  }
  const id = newId("ghi");
  await db.insert(githubIntegration).values({ id, organizationId: ctx.organizationId, createdById: ctx.userId, ...data });
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "github.connected", targetType: "github_integration", targetId: id, metadata: { account: data.accountLogin } });
  return id;
}

export async function listGitHubIntegrations(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:read");
  return db
    .select()
    .from(githubIntegration)
    .where(and(eq(githubIntegration.organizationId, ctx.organizationId), isNull(githubIntegration.suspendedAt)))
    .orderBy(asc(githubIntegration.createdAt));
}

export async function getGitHubIntegration(db: Database, ctx: ActorContext, integrationId: string) {
  const [row] = await db.select().from(githubIntegration).where(and(eq(githubIntegration.id, integrationId), eq(githubIntegration.organizationId, ctx.organizationId)));
  if (!row || row.suspendedAt) throw new DomainError("NOT_FOUND", "GitHub connection not found");
  return row;
}

/** Called from verified webhooks: an uninstalled or suspended app may no longer be used. */
export async function suspendGitHubInstallation(db: Database, installationId: number) {
  await db.update(githubIntegration).set({ suspendedAt: new Date() }).where(eq(githubIntegration.installationId, installationId));
}

export async function unsuspendGitHubInstallation(db: Database, installationId: number) {
  await db.update(githubIntegration).set({ suspendedAt: null }).where(eq(githubIntegration.installationId, installationId));
}

export async function linkRepository(db: Database, ctx: ActorContext, projectId: string, data: { integrationId: string; fullName: string; defaultBranch: string } | null) {
  assertCan(ctx.role, "project:write");
  if (data) {
    await assertEntitlement(db, ctx.organizationId, "github");
    await getGitHubIntegration(db, ctx, data.integrationId);
  }
  const updated = await db
    .update(project)
    .set({
      githubIntegrationId: data?.integrationId ?? null,
      repositoryFullName: data?.fullName ?? null,
      repositoryDefaultBranch: data?.defaultBranch ?? null,
    })
    .where(and(eq(project.id, projectId), eq(project.organizationId, ctx.organizationId)))
    .returning({ id: project.id });
  if (!updated[0]) throw new DomainError("NOT_FOUND", "Project not found");
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: data ? "project.repository_linked" : "project.repository_unlinked", targetType: "project", targetId: projectId, metadata: { repository: data?.fullName ?? null } });
}
