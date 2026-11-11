import { assertCan, DomainError } from "@consyrium/core";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import * as s from "../schema";
import { recordAudit } from "./audit";
import { recordDeletion } from "./deletion-registry";
import type { ActorContext } from "./context";

/** #206: shape version of the workspace export (2: complete council record, integrations, assistant, coverage list). */
export const EXPORT_FORMAT_VERSION = 2;

/**
 * #206: every table of the schema, either exported (with the export key) or left out on purpose. A test fails when a new
 * table appears here in neither form, so the export cannot silently fall behind the schema again.
 */
export const EXPORT_COVERAGE: Record<string, { exported: string } | { excluded: string }> = {
  organization: { exported: "organization" },
  membership: { exported: "members" },
  project: { exported: "projects" },
  project_brief: { exported: "projectBriefs" },
  project_document: { exported: "projectDocuments" },
  requirement_list: { exported: "requirementLists" },
  ai_provider_credential: { exported: "credentials (without the encrypted key)" },
  council_session: { exported: "councilSessions" },
  council_participant: { exported: "participants" },
  council_role_assignment: { exported: "roleAssignments" },
  workflow_stage: { exported: "workflowStages" },
  proposal: { exported: "proposals" },
  proposal_revision: { exported: "proposalRevisions" },
  debate_message: { exported: "debateMessages" },
  minority_objection: { exported: "minorityObjections" },
  human_intervention: { exported: "humanInterventions" },
  human_intervention_answer: { exported: "humanInterventionAnswers" },
  minority_review: { exported: "minorityReviews" },
  consensus_result: { exported: "consensusResults" },
  evaluation_score: { exported: "evaluationScores" },
  vote: { exported: "votes" },
  evaluation_round: { exported: "evaluationRounds" },
  requirement_check: { exported: "requirementChecks" },
  final_decision: { exported: "finalDecisions" },
  human_approval: { exported: "humanApprovals" },
  measurement_result: { exported: "measurementResults" },
  usage_record: { exported: "usage" },
  plan_usage: { exported: "planUsage" },
  development_plan: { exported: "developmentPlans" },
  development_task: { exported: "developmentTasks" },
  agent_execution: { exported: "agentExecutions" },
  code_artifact: { exported: "codeArtifacts" },
  test_run: { exported: "testRuns" },
  code_review: { exported: "codeReviews" },
  model_price_hint: { exported: "modelPriceHints" },
  subscription: { exported: "subscription" },
  github_integration: { exported: "githubIntegrations" },
  invitation: { exported: "invitations (without the token hash)" },
  api_token: { exported: "apiTokens (without the token hash)" },
  delivery_connection: { exported: "deliveryConnections (without the encrypted secret)" },
  delivery_log: { exported: "deliveryLogs" },
  telegram_request: { exported: "telegramRequests" },
  assistant_chat: { exported: "assistantChats (own)" },
  assistant_message: { exported: "assistantMessages (own chats)" },
  assistant_check: { exported: "assistantChecks (own chats)" },
  assistant_usage: { exported: "assistantUsage (own)" },
  assistant_preference: { exported: "assistantPreferences (own)" },
  skill: { exported: "skills (team and own)" },
  skill_version: { exported: "skillVersions" },
  role_profile: { exported: "roleProfiles (team and own)" },
  role_profile_version: { exported: "roleProfileVersions" },
  audit_event: { exported: "auditEvents" },
  feedback: { exported: "feedback (own)" },
  feedback_reply: { exported: "feedbackReplies (to own reports)" },
  user: { excluded: "accounts: members' name and e-mail are in members; no auth data" },
  session: { excluded: "login sessions (auth secrets)" },
  account: { excluded: "sign-in methods and password hashes (auth secrets)" },
  verification: { excluded: "e-mail verification and reset tokens (auth secrets)" },
  job: { excluded: "internal work queue, transient" },
  idempotency_key: { excluded: "request de-duplication, transient" },
  ai_model: { excluded: "platform model catalogue, not workspace data" },
  model_strength_sync: { excluded: "platform model data" },
  plan_definition: { excluded: "platform plans" },
  platform_setting: { excluded: "platform settings" },
  skill_publisher: { excluded: "SkillHub publisher profiles (platform, per account)" },
  skill_report: { excluded: "SkillHub reports (platform moderation)" },
  skill_moderation_log: { excluded: "SkillHub moderation (platform)" },
  deletion_tombstone: { excluded: "ids of deleted workspaces, projects and sessions – restore safety (ADR 0206), no workspace data" },
};

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
    .select({
      id: s.aiProviderCredential.id,
      provider: s.aiProviderCredential.provider,
      label: s.aiProviderCredential.label,
      secretHint: s.aiProviderCredential.secretHint,
      createdAt: s.aiProviderCredential.createdAt,
    })
    .from(s.aiProviderCredential)
    .where(eq(s.aiProviderCredential.organizationId, org));
  const data = {
    /** #206: version of this export's shape; raised when tables or columns are added or removed. */
    exportFormat: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    organization,
    members: await db
      .select({ userId: s.membership.userId, role: s.membership.role, email: s.user.email, name: s.user.name })
      .from(s.membership)
      .innerJoin(s.user, eq(s.user.id, s.membership.userId))
      .where(eq(s.membership.organizationId, org)),
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
    // #15/#41: a human's questions after the verdict and the models' answers.
    humanInterventions: await db.select().from(s.humanIntervention).where(byOrg(s.humanIntervention)),
    humanInterventionAnswers: await db.select().from(s.humanInterventionAnswer).where(byOrg(s.humanInterventionAnswer)),
    evaluationScores: await db.select().from(s.evaluationScore).where(byOrg(s.evaluationScore)),
    finalDecisions: await db.select().from(s.finalDecision).where(byOrg(s.finalDecision)),
    humanApprovals: await db.select().from(s.humanApproval).where(byOrg(s.humanApproval)),
    // #249 gate 2: recorded measurements (self-declarations with evidence).
    measurementResults: await db.select().from(s.measurementResult).where(byOrg(s.measurementResult)),
    developmentPlans: await db.select().from(s.developmentPlan).where(byOrg(s.developmentPlan)),
    developmentTasks: await db.select().from(s.developmentTask).where(byOrg(s.developmentTask)),
    codeArtifacts: await db.select().from(s.codeArtifact).where(byOrg(s.codeArtifact)),
    testRuns: await db.select().from(s.testRun).where(byOrg(s.testRun)),
    codeReviews: await db.select().from(s.codeReview).where(byOrg(s.codeReview)),
    usage: await db.select().from(s.usageRecord).where(byOrg(s.usageRecord)),
    // #201: plan usage ledger (counts only, no content).
    planUsage: await db.select().from(s.planUsage).where(byOrg(s.planUsage)),
    // #206: the rest of the council record – phases, roles, votes, reviews, consensus, evaluation rounds and checks.
    roleAssignments: await db.select().from(s.councilRoleAssignment).where(byOrg(s.councilRoleAssignment)),
    workflowStages: await db.select().from(s.workflowStage).where(byOrg(s.workflowStage)),
    votes: await db.select().from(s.vote).where(byOrg(s.vote)),
    minorityReviews: await db.select().from(s.minorityReview).where(byOrg(s.minorityReview)),
    consensusResults: await db.select().from(s.consensusResult).where(byOrg(s.consensusResult)),
    evaluationRounds: await db.select().from(s.evaluationRound).where(byOrg(s.evaluationRound)),
    requirementChecks: await db.select().from(s.requirementCheck).where(byOrg(s.requirementCheck)),
    agentExecutions: await db.select().from(s.agentExecution).where(byOrg(s.agentExecution)),
    modelPriceHints: await db.select().from(s.modelPriceHint).where(byOrg(s.modelPriceHint)),
    subscription: await db.select().from(s.subscription).where(byOrg(s.subscription)),
    githubIntegrations: await db.select().from(s.githubIntegration).where(byOrg(s.githubIntegration)),
    // Secrets stay out: no invitation token hashes, API token hashes or encrypted delivery secrets.
    invitations: await db
      .select({
        id: s.invitation.id,
        email: s.invitation.email,
        role: s.invitation.role,
        expiresAt: s.invitation.expiresAt,
        acceptedAt: s.invitation.acceptedAt,
        revokedAt: s.invitation.revokedAt,
        createdById: s.invitation.createdById,
        createdAt: s.invitation.createdAt,
      })
      .from(s.invitation)
      .where(byOrg(s.invitation)),
    apiTokens: await db
      .select({
        id: s.apiToken.id,
        userId: s.apiToken.userId,
        name: s.apiToken.name,
        prefix: s.apiToken.prefix,
        scope: s.apiToken.scope,
        lastUsedAt: s.apiToken.lastUsedAt,
        expiresAt: s.apiToken.expiresAt,
        revokedAt: s.apiToken.revokedAt,
        createdAt: s.apiToken.createdAt,
      })
      .from(s.apiToken)
      .where(byOrg(s.apiToken)),
    deliveryConnections: await db
      .select({
        id: s.deliveryConnection.id,
        kind: s.deliveryConnection.kind,
        label: s.deliveryConnection.label,
        config: s.deliveryConnection.config,
        secretHint: s.deliveryConnection.secretHint,
        createdById: s.deliveryConnection.createdById,
      })
      .from(s.deliveryConnection)
      .where(byOrg(s.deliveryConnection)),
    deliveryLogs: await db.select().from(s.deliveryLog).where(byOrg(s.deliveryLog)),
    telegramRequests: await db.select().from(s.telegramRequest).where(byOrg(s.telegramRequest)),
    // The assistant is personal (#241): only the exporting user's own chats, checks, usage and settings.
    ...(await ownAssistant(db, ctx)),
    // Private skills are a visibility boundary (#363): the export holds team skills and the exporting user's own (#408).
    ...(await visibleSkills(db, ctx)),
    ...(await visibleRoleProfiles(db, ctx)),
    auditEvents: await db.select().from(s.auditEvent).where(byOrg(s.auditEvent)),
    // Feedback is personal, not workspace data (#295): only the exporting user's own reports and the replies to them.
    ...(await ownFeedback(db, ctx.userId)),
  };
  await recordAudit(db, { organizationId: org, actorUserId: ctx.userId, action: "privacy.exported", targetType: "organization", targetId: org });
  return data;
}

/** #197: job kind of the purge that removes a project once nothing of it runs any more. */
export const PROJECT_PURGE_JOB = "project.purge";
/** #197: the purge waits at most this long for running councils and builds to stop, then deletes anyway. */
export const PROJECT_PURGE_MAX_WAIT_MS = 30 * 60_000;
const ACTIVE_PLAN = ["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"] as const;

/**
 * #197 (ADR 0197, phase 1): deletion is requested at once – the project becomes "deleting" (invisible and locked for
 * every reader and writer), queued councils, builds and their jobs are cancelled, running ones are asked to stop at
 * their next step (no further model call, no write), and one purge job is queued. Repeating the request while the
 * project is being deleted changes nothing. A model call already in flight finishes at the provider (it may be billed on
 * the user's own key) but its result is dropped.
 */
export async function deleteProjectPermanently(db: Database, ctx: ActorContext, projectId: string, confirmName: string) {
  assertCan(ctx.role, "project:delete");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.project)
      .where(and(eq(s.project.id, projectId), eq(s.project.organizationId, ctx.organizationId)))
      .for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Project not found");
    if (row.status === "deleting") return;
    if (row.name !== confirmName) throw new DomainError("VALIDATION", "Type the project name to confirm");
    await tx.update(s.project).set({ status: "deleting" }).where(eq(s.project.id, projectId));
    const sessions = await tx
      .select({ id: s.councilSession.id, status: s.councilSession.status })
      .from(s.councilSession)
      .where(eq(s.councilSession.projectId, projectId));
    const sessionIds = sessions.map((x) => x.id);
    const plans = sessionIds.length
      ? await tx
          .select({ id: s.developmentPlan.id, status: s.developmentPlan.status })
          .from(s.developmentPlan)
          .where(inArray(s.developmentPlan.sessionId, sessionIds))
      : [];
    const now = new Date();
    for (const x of sessions) {
      if (x.status === "queued") await tx.update(s.councilSession).set({ status: "cancelled", finishedAt: now }).where(eq(s.councilSession.id, x.id));
      else if (x.status === "running") await tx.update(s.councilSession).set({ status: "cancel_requested" }).where(eq(s.councilSession.id, x.id));
    }
    for (const p of plans) {
      if (p.status === "queued" || p.status === "awaiting_plan_approval")
        await tx.update(s.developmentPlan).set({ status: "cancelled", finishedAt: now }).where(eq(s.developmentPlan.id, p.id));
      else if (p.status === "planning" || p.status === "running" || p.status === "reviewing")
        await tx.update(s.developmentPlan).set({ status: "cancel_requested" }).where(eq(s.developmentPlan.id, p.id));
    }
    // Queued jobs of this project never start (they carry the session or plan id in their payload, no foreign key).
    const ids = [...sessionIds, ...plans.map((p) => p.id)];
    if (ids.length)
      await tx
        .update(s.job)
        .set({ status: "failed", lastError: "The project was deleted.", lockedUntil: null })
        .where(and(eq(s.job.status, "queued"), or(inArray(sql`${s.job.payload}->>'sessionId'`, ids), inArray(sql`${s.job.payload}->>'planId'`, ids))));
    await tx
      .insert(s.job)
      .values({
        id: newId("job"),
        kind: PROJECT_PURGE_JOB,
        payload: { projectId, requestedAt: now.toISOString() },
        dedupeKey: `${PROJECT_PURGE_JOB}:${projectId}`,
        organizationId: ctx.organizationId,
      })
      .onConflictDoNothing({ target: s.job.dedupeKey });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "privacy.project_deletion_requested",
      targetType: "project",
      targetId: projectId,
      // Counts only – no name, brief or content.
      metadata: { sessions: sessions.length, builds: plans.length },
    });
  });
}

/**
 * #197 (ADR 0197, phase 2): removes a project marked "deleting" once none of its councils, builds or jobs is still
 * active (or after PROJECT_PURGE_MAX_WAIT_MS), with every dependent row (cascade). Returns "wait" while something still
 * runs. A project that is already gone is success – the purge is safe to repeat.
 */
export async function purgeProject(db: Database, projectId: string, requestedAt: Date, now = new Date()): Promise<"done" | "wait"> {
  const [row] = await db.select({ status: s.project.status, organizationId: s.project.organizationId }).from(s.project).where(eq(s.project.id, projectId));
  if (!row) return "done";
  if (row.status !== "deleting") return "done";
  const sessions = await db
    .select({ id: s.councilSession.id, status: s.councilSession.status })
    .from(s.councilSession)
    .where(eq(s.councilSession.projectId, projectId));
  const sessionIds = sessions.map((x) => x.id);
  const plans = sessionIds.length
    ? await db
        .select({ id: s.developmentPlan.id, status: s.developmentPlan.status })
        .from(s.developmentPlan)
        .where(inArray(s.developmentPlan.sessionId, sessionIds))
    : [];
  const ids = [...sessionIds, ...plans.map((p) => p.id)];
  const runningJobs = ids.length
    ? await db
        .select({ id: s.job.id })
        .from(s.job)
        .where(
          and(
            eq(s.job.status, "running"),
            sql`${s.job.lockedUntil} >= now()`,
            or(inArray(sql`${s.job.payload}->>'sessionId'`, ids), inArray(sql`${s.job.payload}->>'planId'`, ids)),
          ),
        )
    : [];
  const busy =
    runningJobs.length > 0 ||
    sessions.some((x) => x.status === "running" || x.status === "cancel_requested") ||
    plans.some((p) => (ACTIVE_PLAN as readonly string[]).includes(p.status));
  if (busy && now.getTime() - requestedAt.getTime() < PROJECT_PURGE_MAX_WAIT_MS) return "wait";
  await db.delete(s.project).where(eq(s.project.id, projectId));
  await recordAudit(db, {
    organizationId: row.organizationId,
    actorUserId: null,
    action: "privacy.project_deleted",
    targetType: "project",
    targetId: projectId,
    metadata: { sessions: sessions.length, builds: plans.length, ...(busy ? { forcedAfterWait: true } : {}) },
  });
  // #206: after the delete and outside any transaction – a restored backup must not bring the project back.
  await recordDeletion(db, { kind: "project", id: projectId, organizationId: row.organizationId, deletedAt: new Date() });
  return "done";
}

/** Deletes the whole workspace (owner only). All tenant data cascades; users keep their accounts. */
export async function deleteOrganization(db: Database, ctx: ActorContext, confirmName: string) {
  assertCan(ctx.role, "org:manage");
  const [org] = await db.select().from(s.organization).where(eq(s.organization.id, ctx.organizationId));
  if (!org) throw new DomainError("NOT_FOUND", "Organization not found");
  if (org.name !== confirmName) throw new DomainError("VALIDATION", "Type the workspace name to confirm");
  await db.delete(s.organization).where(eq(s.organization.id, ctx.organizationId));
  await recordAudit(db, {
    organizationId: null,
    actorUserId: ctx.userId,
    action: "privacy.organization_deleted",
    targetType: "organization",
    targetId: ctx.organizationId,
  });
  // ADR 0206: a restore of an older backup must not bring the workspace back.
  await recordDeletion(db, { kind: "workspace", id: ctx.organizationId, organizationId: ctx.organizationId, deletedAt: new Date() });
}

/** The user's own feedback reports (from every workspace) with the replies; the replying admin's id is left out. */
async function ownFeedback(db: Database, userId: string) {
  const feedback = await db.select().from(s.feedback).where(eq(s.feedback.userId, userId));
  const feedbackReplies = feedback.length
    ? await db
        .select({ id: s.feedbackReply.id, feedbackId: s.feedbackReply.feedbackId, text: s.feedbackReply.text, createdAt: s.feedbackReply.createdAt })
        .from(s.feedbackReply)
        .where(
          inArray(
            s.feedbackReply.feedbackId,
            feedback.map((f) => f.id),
          ),
        )
    : [];
  return { feedback, feedbackReplies };
}

/** The exporting user's own assistant data in this workspace. */
async function ownAssistant(db: Database, ctx: ActorContext) {
  const mine = <T extends { organizationId: unknown; userId: unknown }>(table: T) =>
    and(eq(table.organizationId as never, ctx.organizationId), eq(table.userId as never, ctx.userId));
  const assistantChats = await db.select().from(s.assistantChat).where(mine(s.assistantChat));
  const chatIds = assistantChats.map((c) => c.id);
  const assistantMessages = chatIds.length ? await db.select().from(s.assistantMessage).where(inArray(s.assistantMessage.chatId, chatIds)) : [];
  const assistantChecks = chatIds.length ? await db.select().from(s.assistantCheck).where(inArray(s.assistantCheck.chatId, chatIds)) : [];
  return {
    assistantChats,
    assistantMessages,
    assistantChecks,
    assistantUsage: await db.select().from(s.assistantUsage).where(mine(s.assistantUsage)),
    assistantPreferences: await db.select().from(s.assistantPreference).where(mine(s.assistantPreference)),
  };
}

/** Skills of the workspace the exporting user may see: shared with the team or their own. */
async function visibleSkills(db: Database, ctx: ActorContext) {
  const skills = await db
    .select()
    .from(s.skill)
    .where(and(eq(s.skill.organizationId, ctx.organizationId), or(eq(s.skill.visibility, "team"), eq(s.skill.ownerUserId, ctx.userId))));
  const ids = skills.map((k) => k.id);
  const skillVersions = ids.length
    ? await db
        .select()
        .from(s.skillVersion)
        .where(and(eq(s.skillVersion.organizationId, ctx.organizationId), inArray(s.skillVersion.skillId, ids)))
    : [];
  return { skills, skillVersions };
}

/** Role profiles of the workspace the exporting user may see (#270): shared with the team or their own. */
async function visibleRoleProfiles(db: Database, ctx: ActorContext) {
  const roleProfiles = await db
    .select()
    .from(s.roleProfile)
    .where(and(eq(s.roleProfile.organizationId, ctx.organizationId), or(eq(s.roleProfile.visibility, "team"), eq(s.roleProfile.ownerUserId, ctx.userId))));
  const ids = roleProfiles.map((p) => p.id);
  const roleProfileVersions = ids.length
    ? await db
        .select()
        .from(s.roleProfileVersion)
        .where(and(eq(s.roleProfileVersion.organizationId, ctx.organizationId), inArray(s.roleProfileVersion.profileId, ids)))
    : [];
  return { roleProfiles, roleProfileVersions };
}
