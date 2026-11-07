import { assertCan, DomainError, MIN_OVERRIDE_REASON, pullRequestReadiness, type ReadinessReview } from "@consyrion/core";
import { recordAudit, schema, type ActorContext, type Database } from "@consyrion/db";
import { checkRuns, createDraftPullRequest, installationClient, readSnapshot, type FetchLike, type GitHubAppConfig } from "@consyrion/github";
import { and, eq } from "drizzle-orm";
import { changedFiles, type RepositoryAccess } from "./executor";

export interface GitHubDeps {
  config: GitHubAppConfig;
  fetchImpl?: FetchLike;
}

async function repositoryClient(db: Database, deps: GitHubDeps, organizationId: string, sessionId: string, repositoryFullName: string, access: "read" | "write" = "read") {
  const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId));
  const [project] = await db.select().from(schema.project).where(and(eq(schema.project.id, session!.projectId), eq(schema.project.organizationId, organizationId)));
  if (!project?.githubIntegrationId || project.repositoryFullName !== repositoryFullName) throw new DomainError("CONFLICT", "The repository is no longer linked to this project");
  const [integration] = await db.select().from(schema.githubIntegration).where(eq(schema.githubIntegration.id, project.githubIntegrationId));
  if (!integration || integration.suspendedAt || integration.organizationId !== organizationId) throw new DomainError("CONFLICT", "The GitHub connection is suspended or removed");
  return installationClient(deps.config, integration.installationId, repositoryFullName, deps.fetchImpl, access);
}

/** Repository read access for the Execution Council worker (token scoped to the one repository). */
export function githubRepositoryAccess(db: Database, deps: GitHubDeps): RepositoryAccess {
  return {
    async snapshot(plan) {
      const client = await repositoryClient(db, deps, plan.organizationId, plan.sessionId, plan.repositoryFullName);
      return readSnapshot(client, { fullName: plan.repositoryFullName, defaultBranch: plan.baseBranch, private: true });
    },
  };
}

async function loadPlanForGitHub(db: Database, ctx: ActorContext, planId: string) {
  const [plan] = await db.select().from(schema.developmentPlan).where(and(eq(schema.developmentPlan.id, planId), eq(schema.developmentPlan.organizationId, ctx.organizationId)));
  if (!plan) throw new DomainError("NOT_FOUND", "Execution run not found");
  if (!plan.repositoryFullName || !plan.baseCommitSha || !plan.baseBranch) throw new DomainError("CONFLICT", "This run was not based on a linked repository");
  return plan;
}

/**
 * Publishes the change set as a DRAFT pull request on a new branch. A separate human action
 * (owner/admin) after the run; merging stays in GitHub and always requires a human.
 */
export async function createPullRequestForPlan(db: Database, ctx: ActorContext, planId: string, deps: GitHubDeps, options: { overrideReason?: string } = {}) {
  assertCan(ctx.role, "decision:approve");
  const plan = await loadPlanForGitHub(db, ctx, planId);
  if (plan.status !== "completed") throw new DomainError("CONFLICT", "The Execution Council run has not completed");
  if (plan.pullRequestUrl) return { number: plan.pullRequestNumber!, url: plan.pullRequestUrl };
  const changes = await changedFiles(db, planId);
  if (changes.length === 0) throw new DomainError("CONFLICT", "There are no changes to publish");

  const tests = await db.select().from(schema.testRun).where(eq(schema.testRun.planId, planId));
  const reviews = await db.select().from(schema.codeReview).where(eq(schema.codeReview.planId, planId));
  const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, plan.sessionId));
  const [project] = await db.select().from(schema.project).where(eq(schema.project.id, session!.projectId));
  const lastTest = tests.filter((t) => !t.kind.endsWith(":install")).at(-1);
  const readiness = pullRequestReadiness(tests, reviews.map((r) => ({ focus: r.focus, verdict: r.verdict, findings: r.findings as ReadinessReview["findings"] })));
  const overrideReason = options.overrideReason?.trim() ?? "";
  if (readiness.blocked && overrideReason.length < MIN_OVERRIDE_REASON) {
    throw new DomainError("CONFLICT", `Quality gate: ${readiness.reasons.join(" ")} Fix the change or publish anyway with a written reason.`);
  }
  const overridden = readiness.blocked;
  const planJson = plan.plan as { summary?: string; tasks?: Array<{ title?: string }> } | null;
  const body = [
    `Implementation of the decision approved in Consyrion (project "${project!.name}", session ${plan.sessionId}).`,
    "",
    `**Plan:** ${planJson?.summary ?? "–"}`,
    `**Latest sandbox test run:** ${lastTest ? `${lastTest.status} (\`${lastTest.command}\`)` : "none"}`,
    `**AI reviews:** ${reviews.map((r) => `${r.focus}: ${r.verdict}`).join("; ") || "none"}`,
    ...(overridden ? ["", `> **Quality gate overridden** by an owner/admin. Blocking reasons: ${readiness.reasons.join(" ")} Reason given: ${overrideReason}`] : []),
    ...readiness.warnings.map((w) => `> Note: ${w}`),
    "",
    ...reviews.flatMap((r) => (r.findings as Array<{ severity: string; file: string; issue: string }>).map((f) => `- [${f.severity}] ${f.file}: ${f.issue}`)),
    "",
    "This is a draft created by Consyrion. Review it like any other contribution; Consyrion never merges.",
  ].join("\n");

  const client = await repositoryClient(db, deps, ctx.organizationId, plan.sessionId, plan.repositoryFullName!, "write");
  const pr = await createDraftPullRequest(client, { fullName: plan.repositoryFullName!, defaultBranch: plan.baseBranch!, private: true }, {
    baseBranch: plan.baseBranch!,
    baseSha: plan.baseCommitSha!,
    branch: `consyrion/${plan.id}`,
    title: pullRequestTitle(planJson?.summary, planJson?.tasks?.[0]?.title),
    body,
    changes: changes.map((c) => ({ path: c.path, content: c.after, mode: c.mode })),
  });
  await db.update(schema.developmentPlan).set({ pullRequestNumber: pr.number, pullRequestUrl: pr.url, pullRequestCommitSha: pr.commitSha }).where(eq(schema.developmentPlan.id, planId));
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "github.pull_request_created", targetType: "development_plan", targetId: planId, metadata: { repository: plan.repositoryFullName, number: pr.number, ...(overridden ? { qualityGateOverride: overrideReason, blockingReasons: readiness.reasons } : {}) } });
  return { number: pr.number, url: pr.url };
}

/** CI status of the pull request commit, read live from GitHub. */
export async function pullRequestChecks(db: Database, ctx: ActorContext, planId: string, deps: GitHubDeps) {
  assertCan(ctx.role, "project:read");
  const plan = await loadPlanForGitHub(db, ctx, planId);
  if (!plan.pullRequestCommitSha) return [];
  const client = await repositoryClient(db, deps, ctx.organizationId, plan.sessionId, plan.repositoryFullName!);
  return checkRuns(client, { fullName: plan.repositoryFullName!, defaultBranch: plan.baseBranch!, private: true }, plan.pullRequestCommitSha);
}

/**
 * PR title: "CONSYRION AI: " and the plan summary's first sentence when it is short; otherwise the first task's title
 * (GitHub build test 08.11.26: "Consyrion: Implement Option A in src/todos.js: add search(query) that…" was cut off and
 * hard to read – "CONSYRION AI: Add search(query) to the todo store" says it). Long text is cut at a word boundary.
 */
export function pullRequestTitle(summary: string | null | undefined, firstTask?: string | null, max = 72) {
  const prefix = "CONSYRION AI: ";
  const room = max - prefix.length;
  const sentence = (summary ?? "").trim().split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, "") ?? "";
  const task = (firstTask ?? "").trim().replace(/[.!?]$/, "");
  const text = sentence && sentence.length <= room ? sentence : task && task.length <= room ? task : sentence || task || "Implement approved decision";
  const full = `${prefix}${text}`;
  if (full.length <= max) return full;
  const cut = full.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2))}…`;
}
