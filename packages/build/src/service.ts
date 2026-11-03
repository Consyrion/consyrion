import { randomUUID } from "node:crypto";
import { assertCan, DomainError, MAX_TASK_ATTEMPTS, pullRequestReadiness, type ReadinessReview } from "@consyrion/core";
import { assertEngineInstalled, enqueue } from "@consyrion/council";
import { assertEntitlement, newId, recordAudit, schema, type ActorContext, type Database } from "@consyrion/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createTwoFilesPatch } from "diff";
import { assertApprovalBuildable } from "./buildable";
import { changedFiles, currentFiles, setPlan } from "./executor";

export const EXECUTION_JOB = "execution.run";

export const executionInput = z.object({
  tokenBudget: z.number().int().min(20_000).max(5_000_000).default(600_000),
  maxRepairAttempts: z.number().int().min(0).max(5).default(2),
  /** Stop after planning until the plan is approved (default). */
  requirePlanApproval: z.boolean().default(true),
});

export const planApprovalInput = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(2_000).optional(),
});

/**
 * Starts the Execution Council for an approved session. Requires decision:approve, a recorded human
 * approval and no other active run. This is the only path to code generation.
 */
export async function startExecution(db: Database, ctx: ActorContext, sessionId: string, input: z.input<typeof executionInput>) {
  assertCan(ctx.role, "decision:approve");
  assertEngineInstalled();
  const parsed = executionInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid execution settings", z.flattenError(parsed.error));
  const [session] = await db
    .select()
    .from(schema.councilSession)
    .where(and(eq(schema.councilSession.id, sessionId), eq(schema.councilSession.organizationId, ctx.organizationId)));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  if (session.status !== "approved") throw new DomainError("CONFLICT", "The Execution Council needs an approved decision");
  const [approval] = await db
    .select()
    .from(schema.humanApproval)
    .where(and(eq(schema.humanApproval.sessionId, sessionId), inArray(schema.humanApproval.action, ["approve", "select_alternative"])))
    .orderBy(desc(schema.humanApproval.createdAt))
    .limit(1);
  if (!approval?.selectedProposalId) throw new DomainError("CONFLICT", "No approved proposal found");
  await assertApprovalBuildable(db, session, approval);
  const active = await db
    .select({ id: schema.developmentPlan.id })
    .from(schema.developmentPlan)
    .where(
      and(
        eq(schema.developmentPlan.sessionId, sessionId),
        inArray(schema.developmentPlan.status, ["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"]),
      ),
    );
  if (active.length) throw new DomainError("CONFLICT", "An Execution Council run is already active");
  await assertEntitlement(db, ctx.organizationId, "execution");
  const [proposal] = await db.select().from(schema.proposal).where(eq(schema.proposal.id, approval.selectedProposalId));
  const [project] = await db.select().from(schema.project).where(eq(schema.project.id, session.projectId));
  const id = newId("pln");
  await db.insert(schema.developmentPlan).values({
    id,
    organizationId: ctx.organizationId,
    sessionId,
    approvalId: approval.id,
    proposalId: approval.selectedProposalId,
    plannerParticipantId: proposal!.authorParticipantId,
    tokenBudget: parsed.data.tokenBudget,
    maxRepairAttempts: parsed.data.maxRepairAttempts,
    requirePlanApproval: parsed.data.requirePlanApproval,
    // A linked repository becomes the base of the workspace; otherwise the run starts empty.
    repositoryFullName: project?.githubIntegrationId ? project.repositoryFullName : null,
    baseBranch: project?.githubIntegrationId ? project.repositoryDefaultBranch : null,
    createdById: ctx.userId,
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "execution.started",
    targetType: "development_plan",
    targetId: id,
    metadata: { sessionId },
  });
  await enqueue(db, EXECUTION_JOB, { planId: id }, `${EXECUTION_JOB}:${id}`, ctx.organizationId);
  return { id };
}

async function loadPlan(db: Database, ctx: ActorContext, planId: string) {
  const [plan] = await db
    .select()
    .from(schema.developmentPlan)
    .where(and(eq(schema.developmentPlan.id, planId), eq(schema.developmentPlan.organizationId, ctx.organizationId)));
  if (!plan) throw new DomainError("NOT_FOUND", "Execution run not found");
  return plan;
}

export async function listExecutions(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "project:read");
  return db
    .select({ id: schema.developmentPlan.id, status: schema.developmentPlan.status, createdAt: schema.developmentPlan.createdAt })
    .from(schema.developmentPlan)
    .where(and(eq(schema.developmentPlan.sessionId, sessionId), eq(schema.developmentPlan.organizationId, ctx.organizationId)))
    .orderBy(desc(schema.developmentPlan.createdAt));
}

export async function getExecutionView(db: Database, ctx: ActorContext, planId: string) {
  assertCan(ctx.role, "project:read");
  const plan = await loadPlan(db, ctx, planId);
  const [tasks, executions, artifacts, tests, reviews, usage, participants] = await Promise.all([
    db.select().from(schema.developmentTask).where(eq(schema.developmentTask.planId, planId)).orderBy(asc(schema.developmentTask.key)),
    db
      .select({
        id: schema.agentExecution.id,
        taskId: schema.agentExecution.taskId,
        participantId: schema.agentExecution.participantId,
        attempt: schema.agentExecution.attempt,
        kind: schema.agentExecution.kind,
        outcome: schema.agentExecution.outcome,
        summary: schema.agentExecution.summary,
        createdAt: schema.agentExecution.createdAt,
      })
      .from(schema.agentExecution)
      .innerJoin(schema.developmentTask, eq(schema.developmentTask.id, schema.agentExecution.taskId))
      .where(eq(schema.developmentTask.planId, planId))
      .orderBy(asc(schema.agentExecution.createdAt)),
    db
      .select({
        id: schema.codeArtifact.id,
        taskId: schema.codeArtifact.taskId,
        path: schema.codeArtifact.path,
        version: schema.codeArtifact.version,
        action: schema.codeArtifact.action,
        sha256: schema.codeArtifact.sha256,
        createdAt: schema.codeArtifact.createdAt,
      })
      .from(schema.codeArtifact)
      .where(eq(schema.codeArtifact.planId, planId))
      .orderBy(asc(schema.codeArtifact.createdAt)),
    db.select().from(schema.testRun).where(eq(schema.testRun.planId, planId)).orderBy(asc(schema.testRun.createdAt)),
    db.select().from(schema.codeReview).where(eq(schema.codeReview.planId, planId)).orderBy(asc(schema.codeReview.createdAt)),
    db
      .select({
        calls: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${schema.usageRecord.inputTokens} + ${schema.usageRecord.outputTokens}), 0)::int`,
      })
      .from(schema.usageRecord)
      .where(eq(schema.usageRecord.planId, planId)),
    db
      .select({ id: schema.councilParticipant.id, provider: schema.councilParticipant.provider, modelId: schema.councilParticipant.modelId })
      .from(schema.councilParticipant)
      .where(eq(schema.councilParticipant.sessionId, plan.sessionId)),
  ]);
  const files = await currentFiles(db, planId);
  const changes = await changedFiles(db, planId);
  return {
    plan,
    tasks,
    executions,
    artifacts: artifacts.filter((a) => a.action !== "base"),
    files: [...files.entries()].map(([path, content]) => {
      const change = changes.find((c) => c.path === path);
      return { path, content, changed: Boolean(change), before: change ? change.before : null };
    }),
    deletedFiles: changes.filter((c) => c.after === null).map((c) => c.path),
    tests,
    reviews,
    // The quality gate before a draft pull request, computed here so the rule stays out of the browser (#189).
    readiness: pullRequestReadiness(
      tests.map((t) => ({ kind: t.kind, status: t.status })),
      reviews.map((r) => ({ focus: r.focus, verdict: r.verdict, findings: r.findings as ReadinessReview["findings"] })),
    ),
    usage: usage[0] ?? { calls: 0, tokens: 0 },
    participants,
  };
}
export type ExecutionView = Awaited<ReturnType<typeof getExecutionView>>;

export async function cancelExecution(db: Database, ctx: ActorContext, planId: string) {
  assertCan(ctx.role, "decision:approve");
  const plan = await loadPlan(db, ctx, planId);
  if (!["queued", "planning", "awaiting_plan_approval", "running", "reviewing"].includes(plan.status))
    throw new DomainError("CONFLICT", "The run is not active");
  const idle = plan.status === "queued" || plan.status === "awaiting_plan_approval";
  await setPlan(db, planId, idle ? { status: "cancelled", finishedAt: new Date() } : { status: "cancel_requested" });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "execution.cancel_requested",
    targetType: "development_plan",
    targetId: planId,
  });
}

/**
 * Human decision on the implementation plan (#45, #56). Approve resumes the run with the stored plan (no new
 * planning call); reject ends it. Requires decision:approve, like starting the run.
 */
export async function decidePlan(db: Database, ctx: ActorContext, planId: string, input: z.input<typeof planApprovalInput>) {
  assertCan(ctx.role, "decision:approve");
  const parsed = planApprovalInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid plan decision", z.flattenError(parsed.error));
  const plan = await loadPlan(db, ctx, planId);
  if (plan.status !== "awaiting_plan_approval") throw new DomainError("CONFLICT", "The plan is not waiting for approval");
  const { action, comment } = parsed.data;
  if (action === "approve") {
    await setPlan(db, planId, { status: "queued", planApprovedAt: new Date(), planApprovedById: ctx.userId, planFeedback: comment ?? null });
    await enqueue(db, EXECUTION_JOB, { planId }, `${EXECUTION_JOB}:${planId}:implement`, ctx.organizationId);
  } else {
    await setPlan(db, planId, { status: "cancelled", planFeedback: comment ?? null, finishedAt: new Date() });
  }
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: `execution.plan_${action === "approve" ? "approved" : "rejected"}`,
    targetType: "development_plan",
    targetId: planId,
    metadata: comment ? { comment } : {},
  });
  return { status: action === "approve" ? "queued" : "cancelled" };
}

export const resumeInput = z.object({
  /** Optional explicit hand-over of the failed tasks to another model of the council; never done silently. */
  participantId: z.string().min(1).optional(),
});

/**
 * Resumes a failed run from its checkpoints (#107): failed coding tasks are reset and run again, done tasks and
 * their files stay as they are, tasks waiting for the failed ones start afterwards. Tests and reviews that did
 * not happen yet follow as usual. Bounded by MAX_TASK_ATTEMPTS per task and by the run's token budget.
 */
export async function resumeExecution(db: Database, ctx: ActorContext, planId: string, input: z.input<typeof resumeInput> = {}) {
  assertCan(ctx.role, "decision:approve");
  const parsed = resumeInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid resume request", z.flattenError(parsed.error));
  const plan = await loadPlan(db, ctx, planId);
  if (plan.status !== "failed") throw new DomainError("CONFLICT", "Only a failed run can be resumed");
  if (!plan.plan) throw new DomainError("CONFLICT", "The run failed before a plan existed – start a new run instead");
  if (plan.tokensUsed >= plan.tokenBudget) throw new DomainError("BUDGET_EXCEEDED", "The run's token budget is used up – start a new run with a fresh budget");
  const active = await db
    .select({ id: schema.developmentPlan.id })
    .from(schema.developmentPlan)
    .where(
      and(
        eq(schema.developmentPlan.sessionId, plan.sessionId),
        inArray(schema.developmentPlan.status, ["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"]),
      ),
    );
  if (active.length) throw new DomainError("CONFLICT", "An Execution Council run is already active");
  const failed = await db
    .select()
    .from(schema.developmentTask)
    .where(and(eq(schema.developmentTask.planId, planId), eq(schema.developmentTask.status, "failed")));
  const exhausted = failed.filter((t) => t.attempts >= MAX_TASK_ATTEMPTS);
  if (exhausted.length)
    throw new DomainError(
      "CONFLICT",
      `${exhausted.map((t) => t.key).join(", ")} already had ${MAX_TASK_ATTEMPTS} attempts – start a new run or revise the decision`,
    );
  const { participantId } = parsed.data;
  if (participantId) {
    const [participant] = await db
      .select()
      .from(schema.councilParticipant)
      .where(and(eq(schema.councilParticipant.id, participantId), eq(schema.councilParticipant.sessionId, plan.sessionId)));
    if (!participant || participant.status !== "active") throw new DomainError("VALIDATION", "Choose an active model of this council");
  }
  await db.transaction(async (tx) => {
    for (const task of failed) {
      await tx
        .update(schema.developmentTask)
        .set({ status: "pending", error: null, ...(participantId ? { assignedParticipantId: participantId } : {}) })
        .where(eq(schema.developmentTask.id, task.id));
    }
  });
  await setPlan(db, planId, { status: "queued", error: null, finishedAt: null });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "execution.resumed",
    targetType: "development_plan",
    targetId: planId,
    metadata: { tasks: failed.map((t) => t.key), ...(participantId ? { reassignedTo: participantId, from: failed.map((t) => t.assignedParticipantId) } : {}) },
  });
  await enqueue(db, EXECUTION_JOB, { planId }, `${EXECUTION_JOB}:${planId}:resume:${randomUUID()}`, ctx.organizationId);
  return { status: "queued" as const, tasks: failed.map((t) => t.key) };
}

/** Unified diff of the change set against the repository base (or empty base) – `git apply` compatible. */
export async function exportPatch(db: Database, ctx: ActorContext, planId: string): Promise<string> {
  assertCan(ctx.role, "project:read");
  await loadPlan(db, ctx, planId);
  const parts: string[] = [];
  for (const change of await changedFiles(db, planId)) {
    const header = [`diff --git a/${change.path} b/${change.path}`];
    if (change.before === null) header.push(`new file mode ${change.mode}`);
    if (change.after === null) header.push(`deleted file mode ${change.mode}`);
    const patch = createTwoFilesPatch(
      change.before === null ? "/dev/null" : `a/${change.path}`,
      change.after === null ? "/dev/null" : `b/${change.path}`,
      change.before ?? "",
      change.after ?? "",
      undefined,
      undefined,
      { context: 3 },
    );
    // Drop the "Index"/"====" preamble that jsdiff adds; keep the ---/+++ and hunks.
    parts.push(...header, ...patch.split("\n").filter((line) => !line.startsWith("Index:") && !/^=+$/.test(line)));
  }
  return parts.join("\n").replace(/\n+$/, "") + "\n";
}
