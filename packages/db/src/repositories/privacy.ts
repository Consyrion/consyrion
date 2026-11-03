import { assertCan, DomainError } from "@consyrion/core";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

/**
 * Data export of one organization (owner only). Contains everything the workspace produced, but no
 * secrets: encrypted provider keys, invitation token hashes and auth data are excluded.
 */
export async function exportOrganization(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:manage");
  const org = ctx.organizationId;
  const byOrg = <T extends { organizationId: unknown }>(table: T) => eq(table.organizationId as never, org);
  const [organization] = await db.select().from(s.organization).where(eq(s.organization.id, org));
  const credentials = await db
    .select({ id: s.aiProviderCredential.id, provider: s.aiProviderCredential.provider, label: s.aiProviderCredential.label, secretHint: s.aiProviderCredential.secretHint, createdAt: s.aiProviderCredential.createdAt })
    .from(s.aiProviderCredential)
    .where(eq(s.aiProviderCredential.organizationId, org));
  const data = {
    exportedAt: new Date().toISOString(),
    organization,
    members: await db.select({ userId: s.membership.userId, role: s.membership.role, email: s.user.email, name: s.user.name }).from(s.membership).innerJoin(s.user, eq(s.user.id, s.membership.userId)).where(eq(s.membership.organizationId, org)),
    projects: await db.select().from(s.project).where(byOrg(s.project)),
    projectBriefs: await db.select().from(s.projectBrief).where(byOrg(s.projectBrief)),
    projectDocuments: await db.select().from(s.projectDocument).where(byOrg(s.projectDocument)),
    requirementLists: await db.select().from(s.requirementList).where(byOrg(s.requirementList)),
    credentials,
    councilSessions: await db.select().from(s.councilSession).where(byOrg(s.councilSession)),
    participants: await db.select().from(s.councilParticipant).where(byOrg(s.councilParticipant)),
    proposals: await db.select().from(s.proposal).where(byOrg(s.proposal)),
    proposalRevisions: await db.select().from(s.proposalRevision).where(byOrg(s.proposalRevision)),
    debateMessages: await db.select().from(s.debateMessage).where(byOrg(s.debateMessage)),
    minorityObjections: await db.select().from(s.minorityObjection).where(byOrg(s.minorityObjection)),
    evaluationScores: await db.select().from(s.evaluationScore).where(byOrg(s.evaluationScore)),
    finalDecisions: await db.select().from(s.finalDecision).where(byOrg(s.finalDecision)),
    humanApprovals: await db.select().from(s.humanApproval).where(byOrg(s.humanApproval)),
    developmentPlans: await db.select().from(s.developmentPlan).where(byOrg(s.developmentPlan)),
    developmentTasks: await db.select().from(s.developmentTask).where(byOrg(s.developmentTask)),
    codeArtifacts: await db.select().from(s.codeArtifact).where(byOrg(s.codeArtifact)),
    testRuns: await db.select().from(s.testRun).where(byOrg(s.testRun)),
    codeReviews: await db.select().from(s.codeReview).where(byOrg(s.codeReview)),
    usage: await db.select().from(s.usageRecord).where(byOrg(s.usageRecord)),
    auditEvents: await db.select().from(s.auditEvent).where(byOrg(s.auditEvent)),
  };
  await recordAudit(db, { organizationId: org, actorUserId: ctx.userId, action: "privacy.exported", targetType: "organization", targetId: org });
  return data;
}

/** Permanently deletes a project with all sessions, proposals, runs and documents (cascade). */
export async function deleteProjectPermanently(db: Database, ctx: ActorContext, projectId: string, confirmName: string) {
  assertCan(ctx.role, "project:delete");
  const [row] = await db.select().from(s.project).where(and(eq(s.project.id, projectId), eq(s.project.organizationId, ctx.organizationId)));
  if (!row) throw new DomainError("NOT_FOUND", "Project not found");
  if (row.name !== confirmName) throw new DomainError("VALIDATION", "Type the project name to confirm");
  await db.delete(s.project).where(eq(s.project.id, projectId));
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "privacy.project_deleted", targetType: "project", targetId: projectId });
}

/** Deletes the whole workspace (owner only). All tenant data cascades; users keep their accounts. */
export async function deleteOrganization(db: Database, ctx: ActorContext, confirmName: string) {
  assertCan(ctx.role, "org:manage");
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, ctx.organizationId));
  if (!org) throw new DomainError("NOT_FOUND", "Organization not found");
  if (org.name !== confirmName) throw new DomainError("VALIDATION", "Type the workspace name to confirm");
  await db.delete(s.organization).where(eq(s.organization.id, ctx.organizationId));
  await recordAudit(db, { organizationId: null, actorUserId: ctx.userId, action: "privacy.organization_deleted", targetType: "organization", targetId: ctx.organizationId });
}
