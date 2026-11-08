import { assertCan, DomainError, MIN_OVERRIDE_REASON, pullRequestReadiness, type ReadinessReview } from "@consyrion/core";
import { assertSessionProjectWritable, recordAudit, schema, type ActorContext, type Database } from "@consyrion/db";
import { checkRuns, createDraftPullRequest, installationClient, readSnapshot, type FetchLike, type GitHubAppConfig } from "@consyrion/github";
import { and, desc, eq } from "drizzle-orm";
import { changedFiles, type RepositoryAccess } from "./executor";
import { ciRisks, describeCiRisk } from "./ci-risk";

export interface GitHubDeps {
  config: GitHubAppConfig;
  fetchImpl?: FetchLike;
}

async function repositoryClient(
  db: Database,
  deps: GitHubDeps,
  organizationId: string,
  sessionId: string,
  repositoryFullName: string,
  access: "read" | "write" = "read",
) {
  const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId));
  const [project] = await db
    .select()
    .from(schema.project)
    .where(and(eq(schema.project.id, session!.projectId), eq(schema.project.organizationId, organizationId)));
  if (!project?.githubIntegrationId || project.repositoryFullName !== repositoryFullName)
    throw new DomainError("CONFLICT", "The repository is no longer linked to this project");
  const [integration] = await db.select().from(schema.githubIntegration).where(eq(schema.githubIntegration.id, project.githubIntegrationId));
  if (!integration || integration.suspendedAt || integration.organizationId !== organizationId)
    throw new DomainError("CONFLICT", "The GitHub connection is suspended or removed");
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

/** Title prefix of a prototype/measurement build's draft pull request (#249 part 2). */
export const PROTOTYPE_TITLE_PREFIX = "[Prototype – not a finished solution] ";

async function loadPlanForGitHub(db: Database, ctx: ActorContext, planId: string) {
  const [plan] = await db
    .select()
    .from(schema.developmentPlan)
    .where(and(eq(schema.developmentPlan.id, planId), eq(schema.developmentPlan.organizationId, ctx.organizationId)));
  if (!plan) throw new DomainError("NOT_FOUND", "Execution run not found");
  if (!plan.repositoryFullName || !plan.baseCommitSha || !plan.baseBranch) throw new DomainError("CONFLICT", "This run was not based on a linked repository");
  return plan;
}

/**
 * Publishes the change set as a DRAFT pull request on a new branch. A separate human action
 * (owner/admin) after the run; merging stays in GitHub and always requires a human.
 */
export async function createPullRequestForPlan(
  db: Database,
  ctx: ActorContext,
  planId: string,
  deps: GitHubDeps,
  options: { overrideReason?: string; confirmCiChanges?: boolean } = {},
) {
  assertCan(ctx.role, "decision:approve");
  const plan = await loadPlanForGitHub(db, ctx, planId);
  if (plan.status !== "completed") throw new DomainError("CONFLICT", "The Execution Council run has not completed");
  // #197: no pull request is published from an archived project.
  await assertSessionProjectWritable(db, ctx, plan.sessionId);
  if (plan.pullRequestUrl) return { number: plan.pullRequestNumber!, url: plan.pullRequestUrl };
  const changes = await changedFiles(db, planId);
  if (changes.length === 0) throw new DomainError("CONFLICT", "There are no changes to publish");

  const tests = await db.select().from(schema.testRun).where(eq(schema.testRun.planId, planId));
  const reviews = await db.select().from(schema.codeReview).where(eq(schema.codeReview.planId, planId));
  const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, plan.sessionId));
  const [project] = await db.select().from(schema.project).where(eq(schema.project.id, session!.projectId));
  const lastTest = tests.filter((t) => !t.kind.endsWith(":install")).at(-1);
  const readiness = pullRequestReadiness(
    tests,
    reviews.map((r) => ({ focus: r.focus, verdict: r.verdict, findings: r.findings as ReadinessReview["findings"] })),
  );
  const overrideReason = options.overrideReason?.trim() ?? "";
  if (readiness.blocked && overrideReason.length < MIN_OVERRIDE_REASON) {
    throw new DomainError("CONFLICT", `Quality gate: ${readiness.reasons.join(" ")} Fix the change or publish anyway with a written reason.`);
  }
  const overridden = readiness.blocked;
  // Files the repository's CI executes on the draft PR, with its secrets (#400): published only after the person
  // confirmed that they looked at them.
  const risks = ciRisks(changes);
  if (risks.length && options.confirmCiChanges !== true)
    throw new DomainError("CONFLICT", `Review the CI-relevant changes first, then confirm them: ${risks.map(describeCiRisk).join("; ")}`);
  const planJson = plan.plan as { summary?: string; tasks?: Array<{ title?: string }> } | null;
  // Night test R4: the first task ("write the tests (red)") named only a sub-step – the approved proposal names the change.
  const [approved] = await db
    .select({ content: schema.proposalRevision.content })
    .from(schema.proposalRevision)
    .where(eq(schema.proposalRevision.proposalId, plan.proposalId))
    .orderBy(desc(schema.proposalRevision.version))
    .limit(1);
  const approvedTitle = (approved?.content as { title?: unknown } | undefined)?.title;
  // #249 part 2 (variant B): a prototype/measurement build is marked in title and body – never a finished solution.
  const prototype = plan.kind === "prototype";
  const body = [
    ...(prototype
      ? [
          "> **Prototype / measurement build – not a finished solution.** The council could not confirm every requirement before implementation; this change exists to measure the open requirements. It was not approved as a solution and must not be merged as one.",
          "",
        ]
      : []),
    prototype
      ? `Prototype build for a proposal of a verdict that still needs verification in Consyrion (project "${project!.name}", session ${plan.sessionId}).`
      : `Implementation of the decision approved in Consyrion (project "${project!.name}", session ${plan.sessionId}).`,
    "",
    `**Plan:** ${planJson?.summary ?? "–"}`,
    `**Latest sandbox test run:** ${lastTest ? `${lastTest.status} (\`${lastTest.command}\`)` : "none"}`,
    `**AI reviews:** ${reviews.map((r) => `${r.focus}: ${r.verdict}`).join("; ") || "none"}`,
    ...(overridden
      ? ["", `> **Quality gate overridden** by an owner/admin. Blocking reasons: ${readiness.reasons.join(" ")} Reason given: ${overrideReason}`]
      : []),
    ...readiness.warnings.map((w) => `> Note: ${w}`),
    ...(risks.length
      ? [
          "",
          "> **CI-relevant changes – review them before you let workflows run on this pull request.** They were confirmed in Consyrion by the person who created it.",
          ...risks.map((r) => `> - ${describeCiRisk(r)}`),
        ]
      : []),
    "",
    ...reviews.flatMap((r) => (r.findings as Array<{ severity: string; file: string; issue: string }>).map((f) => `- [${f.severity}] ${f.file}: ${f.issue}`)),
    "",
    "This is a draft created by Consyrion. Review it like any other contribution; Consyrion never merges.",
  ].join("\n");

  const client = await repositoryClient(db, deps, ctx.organizationId, plan.sessionId, plan.repositoryFullName!, "write");
  const pr = await createDraftPullRequest(
    client,
    { fullName: plan.repositoryFullName!, defaultBranch: plan.baseBranch!, private: true },
    {
      baseBranch: plan.baseBranch!,
      baseSha: plan.baseCommitSha!,
      branch: `consyrion/${plan.id}`,
      title: `${prototype ? PROTOTYPE_TITLE_PREFIX : ""}${pullRequestTitle(planJson?.summary, planJson?.tasks?.[0]?.title, prototype ? 72 - PROTOTYPE_TITLE_PREFIX.length : 72, typeof approvedTitle === "string" ? approvedTitle : null)}`,
      body,
      changes: changes.map((c) => ({ path: c.path, content: c.after, mode: c.mode })),
    },
  );
  await db
    .update(schema.developmentPlan)
    .set({ pullRequestNumber: pr.number, pullRequestUrl: pr.url, pullRequestCommitSha: pr.commitSha })
    .where(eq(schema.developmentPlan.id, planId));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "github.pull_request_created",
    targetType: "development_plan",
    targetId: planId,
    metadata: {
      repository: plan.repositoryFullName,
      number: pr.number,
      ...(overridden ? { qualityGateOverride: overrideReason, blockingReasons: readiness.reasons } : {}),
      ...(prototype ? { kind: "prototype" } : {}),
    },
  });
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
export function pullRequestTitle(summary: string | null | undefined, firstTask?: string | null, max = 72, approvedTitle?: string | null) {
  const prefix = "CONSYRION AI: ";
  const room = max - prefix.length;
  const sentence =
    (summary ?? "")
      .trim()
      .split(/(?<=[.!?])\s/)[0]
      ?.replace(/[.!?]$/, "") ?? "";
  const task = (firstTask ?? "").trim().replace(/[.!?]$/, "");
  // The approved proposal's title names the whole change; it wins (cut at a word when long).
  const title = (approvedTitle ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]$/, "");
  const text = title
    ? title
    : sentence && sentence.length <= room
      ? sentence
      : task && task.length <= room
        ? task
        : sentence || task || "Implement approved decision";
  const full = `${prefix}${text}`;
  if (full.length <= max) return full;
  const cut = full.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2))}…`;
}
