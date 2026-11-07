import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import {
  createCredential,
  createDatabase,
  createOrganization,
  createProject,
  deleteCredential,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
  setSubscriptionPlan,
} from "@consyrion/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  cancelSession,
  claimNext,
  enqueue,
  runWorker,
  workerCapacityFromEnv,
  completeJob,
  createSession,
  credentialAdapterResolver,
  getSessionView,
  runSession,
  submitApproval,
  buildDecisionReport,
  reportToMarkdown,
  previewSession,
  looksRepetitive,
  ADJUDICATION_BATCH_SIZE,
  JUDGE_PARALLEL_CALLS,
  type SessionInput,
} from "../src";
import type { GenerateRequest } from "@consyrion/ai";
import { ScriptedAdapter, type Script } from "./scripted-adapter";
import { confirmProposedRequirements } from "./confirm-requirements";

let handle: DatabaseHandle;
/** Enough for Independent Thinking and the reserved Final Verdict of two models, not for the whole debate. */
const BUDGET_FOR_SHORTENED_RUN = 55_000;
let actor: ActorContext;
let projectId: string;
let credentialId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  // Plan limits are tested separately; these tests use the largest plan.
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  projectId = (
    await createProject(handle.db, actor, {
      name: "Repo analyzer",
      type: "architecture",
      brief: { idea: "Design the best architecture for a SaaS that analyzes GitHub repositories." },
    })
  ).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  // A council starts only on a confirmed requirement list (#190); the intake itself is tested in requirements.test.ts.
  await confirmProposedRequirements(handle.db, actor, projectId);
});

afterEach(async () => {
  await handle.close();
});

function council(scripts: Record<string, Script>) {
  const adapters = new Map(Object.entries(scripts).map(([model, script]) => [model, new ScriptedAdapter(script)]));
  return {
    adapters,
    deps: { db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 },
    participants: Object.keys(scripts).map((modelId) => ({ credentialId, modelId })),
  };
}

async function start(participants: SessionInput["participants"], extra: Partial<SessionInput> = {}) {
  // Budget confirmation (#148) is tested on its own; elsewhere the upper bound is not the subject.
  await confirmProposedRequirements(handle.db, actor, projectId);
  const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true, ...extra });
  return id;
}

/**
 * A council started before the S1 release (#181): its session carries gate version 1 and it finishes with the
 * production gate of e33a3bb. Used by the tests of that legacy path.
 */
async function startV1(participants: SessionInput["participants"], extra: Partial<SessionInput> = {}) {
  const id = await start(participants, extra);
  await handle.db.update(schema.councilSession).set({ gateVersion: 1 }).where(eq(schema.councilSession.id, id));
  return id;
}

describe("council engine", () => {
  it("runs all phases, isolates Independent Thinking and produces a reproducible verdict", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 6) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 6) },
      m3: { title: "Serverless", score: (t) => (t === "Monolith" ? 9 : 6) },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);

    expect(view.session.status).toBe("awaiting_approval");
    expect(view.stages.filter((s) => s.phase !== "execution_council").every((s) => s.status === "completed")).toBe(true);
    expect(view.stages.find((s) => s.phase === "execution_council")!.status).toBe("pending");
    // Identical brief, no peer content during Independent Thinking.
    const firstPrompts = [...c.adapters.values()].map((a) => a.requests[0]!.messages[0]!.content);
    expect(new Set(firstPrompts).size).toBe(1);
    expect(firstPrompts[0]).not.toContain("<proposal");
    expect(view.proposals.map((p) => p.label)).toEqual(["A", "B", "C"]);
    expect(view.decision!.outcome).toBe("recommended");
    const winner = view.proposals.find((p) => p.id === view.decision!.recommendedProposalId)!;
    expect((winner.revisions.at(-1)!.content as { title: string }).title).toBe("Monolith");
    // Revisions are appended, originals kept.
    expect(winner.revisions.map((r) => r.version)).toEqual([1, 2]);
    // No self-evaluation stored.
    for (const score of view.scores) {
      const proposal = view.proposals.find((p) => p.revisions.some((r) => r.id === score.revisionId))!;
      expect(proposal.authorParticipantId).not.toBe(score.evaluatorParticipantId);
    }
    const markdown = reportToMarkdown(buildDecisionReport(view));
    expect(markdown).toContain("Recommended solution");
    expect(markdown).toContain("## Objections (Minority Review)");
    // The debate transcript is exported (#41).
    expect(markdown).toContain("## Debate");
    // Every model delivered in every phase: valid participation 3/3 (#182).
    expect(view.participation).toMatchObject({ valid: 3, total: 3, percent: 100, shortfalls: [] });
    expect(markdown).toContain("Valid participation: 3/3 (100 %)");
    expect(buildDecisionReport(view).debate.some((m) => m.kind === "question" || m.kind === "critique")).toBe(true);
    expect(view.session.tokensUsed).toBeGreaterThan(0);
    // The prompt template version is recorded with the run (#11).
    expect(view.session.promptVersion).toBe(PROMPT_VERSION);
    // Full run of every phase; generous timeout because it also warms up the in-memory database.
  }, 30_000);

  it("blocks the majority favourite when one model proves a critical security risk (11:1)", async () => {
    const preferMonolith = (labels: string[], _own: string, prompt: string) =>
      labels.find((l) => prompt.includes(`<proposal label="${l}">`) && prompt.split(`<proposal label="${l}">`)[1]!.includes('"title": "Monolith"'))!;
    const c = council({
      m1: { title: "Monolith", prefer: preferMonolith, score: (t) => (t === "Monolith" ? 9 : 7) },
      m2: { title: "Microservices", prefer: preferMonolith, adjudicate: () => "accepted", score: (t) => (t === "Monolith" ? 9 : 7) },
      m3: {
        title: "Serverless",
        prefer: (labels, own, prompt) => labels.find((l) => prompt.split(`<proposal label="${l}">`)[1]?.includes(`"title": "${own}"`))!,
        critiques: [{ againstTitle: "Monolith", claim: "Tokens stored in plain text", category: "security", severity: "critical" }],
        adjudicate: () => "accepted",
        score: (t) => (t === "Monolith" ? 9 : 7),
      },
    });
    // Adversarial mode: 12 roles, so the majority is overwhelmingly for the monolith.
    const id = await start(c.participants, { mode: "adversarial_review" });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const monolith = view.proposals.find((p) => (p.revisions[0]!.content as { title: string }).title === "Monolith")!;
    expect(view.minorityReview!.favoredProposalId).toBe(monolith.id);
    const blocking = view.objections.filter((o) => o.proposalId === monolith.id && o.blocking);
    expect(blocking.length).toBeGreaterThan(0);
    expect(view.decision!.recommendedProposalId).not.toBe(monolith.id);
    await expect(
      submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: monolith.id, comment: "I like it" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("closes a refuted objection and keeps it in the report", async () => {
    const c = council({
      m1: { title: "Monolith", score: () => 8 },
      m2: {
        title: "Microservices",
        critiques: [{ againstTitle: "Monolith", claim: "Will not scale", category: "performance", severity: "high" }],
        score: () => 6,
      },
      m3: { title: "Serverless", adjudicate: () => "refuted", score: () => 6 },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections.length).toBeGreaterThan(0);
    // m3 is the only model that neither wrote nor raised it; it refutes → closed, not blocking.
    expect(view.objections.every((o) => o.status === "refuted" && !o.blocking)).toBe(true);
    expect(reportToMarkdown(buildDecisionReport(view))).toContain("Will not scale");
  });

  it("leaves an objection unresolved when no independent reviewer exists", async () => {
    const c = council({
      m1: { title: "Monolith" },
      m2: {
        title: "Microservices",
        critiques: [{ againstTitle: "Monolith", claim: "Will not scale", category: "performance", severity: "high" }],
        adjudicate: () => "refuted",
      },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections[0]).toMatchObject({ status: "unresolved", resolutionReason: expect.stringContaining("No independent reviewer was available") });
    expect(view.minorityReview!.reevaluationTriggered).toBe(true);
  });

  it("continues when one model fails and records the failure", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" }, m3: { title: "Broken", fail: true } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    expect(view.participants.find((p) => p.modelId === "m3")!.status).toBe("failed");
    expect(view.proposals).toHaveLength(2);
  });

  it("retries once with a corrective prompt when an answer is invalid or cut off", async () => {
    const c = council({
      m1: { title: "Monolith", invalidEvaluations: 1 },
      m2: { title: "Microservices", truncatedProposals: 1 },
      m3: { title: "Serverless" },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.proposals).toHaveLength(3);
    expect(view.votes).toHaveLength(3);
    const m1Eval = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "evaluation");
    expect(m1Eval).toHaveLength(2);
    expect(m1Eval[1]!.messages[0]!.content).toContain("did not match the required JSON structure");
    const m2Proposal = c.adapters.get("m2")!.requests.filter((r) => r.jsonSchema!.name === "proposal");
    expect(m2Proposal).toHaveLength(2);
    expect(m2Proposal[1]!.maxOutputTokens).toBeGreaterThan(m2Proposal[0]!.maxOutputTokens);
    const decision = view.decision!.matrix as { confidence: string; failedEvaluators: unknown[] };
    expect(decision.failedEvaluators).toEqual([]);
  });

  it("test cases 30.10.26: a Final Verdict cut off but reported as finished is repaired as cut off (concise, larger limit)", async () => {
    const c = council({ m1: { title: "Monolith", silentlyTruncatedEvaluations: 1 }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const evaluations = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "evaluation");
    expect(evaluations).toHaveLength(2);
    expect(evaluations[1]!.messages[0]!.content).toContain("cut off at the output limit");
    expect(evaluations[1]!.maxOutputTokens).toBeGreaterThan(evaluations[0]!.maxOutputTokens);
    const view = await getSessionView(handle.db, actor, id);
    expect((view.decision!.matrix as { failedEvaluators: unknown[] }).failedEvaluators).toEqual([]);
  });

  it("gives a model that did not answer in time one more, longer attempt instead of dropping it", async () => {
    const c = council({ m1: { title: "Monolith", hangingProposals: 1 }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    // A short call timeout keeps the test fast; the hanging request only ends when it fires.
    const [row] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    await handle.db
      .update(schema.councilSession)
      .set({ policy: { ...row!.policy, callTimeoutMs: 50 } })
      .where(eq(schema.councilSession.id, id));
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.proposals).toHaveLength(2);
    const m1Proposal = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "proposal");
    // Exactly one repair attempt, no transient retries of the timed-out call.
    expect(m1Proposal).toHaveLength(2);
    expect(m1Proposal[1]!.messages[0]!.content).toContain("did not arrive in time");
    const outcomes = view.usage
      .filter((u) => u.phase === "independent_thinking" && u.participantId === view.participants.find((p) => p.modelId === "m1")!.id)
      .map((u) => u.outcome);
    expect(outcomes.sort()).toEqual(["error", "ok"]);
  });

  it("retries an overloaded provider once more after a pause instead of dropping the model (#146)", async () => {
    // Three 503 answers use up the quick retries; the late retry gets a proposal.
    const c = council({ m1: { title: "Monolith", unavailableProposals: 3 }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    await runSession({ ...c.deps, transientRetryDelayMs: 20 }, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.participants.find((p) => p.modelId === "m1")!.status).toBe("active");
    expect(view.proposals).toHaveLength(2);
    expect(c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "proposal")).toHaveLength(4);

    // Still overloaded after the pause: the model drops out with a reason that names the overload, not "invalid".
    const down = council({ m1: { title: "Monolith", unavailableProposals: Infinity }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
    const second = await start(down.participants);
    await runSession({ ...down.deps, transientRetryDelayMs: 20 }, second);
    const failed = (await getSessionView(handle.db, actor, second)).participants.find((p) => p.modelId === "m1")!;
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toContain("overloaded or unavailable (HTTP 503)");
  });

  it("stops waiting for the late retry when the session is cancelled (#146)", async () => {
    const c = council({ m1: { title: "Monolith", unavailableProposals: Infinity }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    const run = runSession({ ...c.deps, transientRetryDelayMs: 60_000 }, id);
    // Cancel while m1 waits for its late retry; the wait notices it within one slice (5 s), not after 60 s.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await cancelSession(handle.db, actor, id);
    await run;
    expect((await getSessionView(handle.db, actor, id)).session.status).toBe("cancelled");
  }, 20_000);

  it("gives a timed-out model that is then cut off one last attempt with a doubled limit (#147)", async () => {
    const c = council({ m1: { title: "Monolith", hangingProposals: 1, truncatedProposals: 1 }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    const [row] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    await handle.db
      .update(schema.councilSession)
      .set({ policy: { ...row!.policy, callTimeoutMs: 50 } })
      .where(eq(schema.councilSession.id, id));
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.participants.find((p) => p.modelId === "m1")!.status).toBe("active");
    const m1Proposal = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "proposal");
    expect(m1Proposal).toHaveLength(3);
    expect(m1Proposal[2]!.maxOutputTokens).toBe(2 * m1Proposal[1]!.maxOutputTokens);
  });

  it("flags a verdict as low confidence when an evaluator fails twice", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 6) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 6) },
      m3: { title: "Serverless", invalidEvaluations: Infinity },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    const matrix = view.decision!.matrix as {
      confidence: string;
      confidenceIssues: Array<{ kind: string }>;
      failedEvaluators: Array<{ modelId: string; outcome: string }>;
    };
    expect(matrix.failedEvaluators).toEqual([expect.objectContaining({ modelId: "m3", outcome: "invalid_output" })]);
    expect(matrix.confidence).toBe("low");
    expect(matrix.confidenceIssues.some((i) => i.kind === "missing_evaluators")).toBe(true);
    expect(reportToMarkdown(buildDecisionReport(view))).toContain("Low confidence");
  });

  it("binds every score to the proposal it names – a label mix-up is corrected or rejected (#93)", async () => {
    // The brief names its own options A/B; model proposal B is the CSV option, A the push option.
    await handle.db.update(schema.projectBrief).set({ idea: "Option A: CSV export. Option B: push notifications. Which first?" });
    const c = council({
      m1: { title: "Push notifications via service workers", mixedUpEvaluations: 1 },
      m2: { title: "CSV export without push channel" },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    let view = await getSessionView(handle.db, actor, id);
    const m1Eval = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "evaluation");
    expect(m1Eval).toHaveLength(2);
    expect(m1Eval[0]!.messages[0]!.content).toContain("unrelated to any options");
    expect(m1Eval[1]!.messages[0]!.content).toContain("mixed up the proposals");
    // The stored rationale of m1 for the CSV proposal is about CSV, not about push.
    const csv = view.proposals.find((p) => p.authorParticipantId === view.participants.find((x) => x.modelId === "m2")!.id)!;
    const m1Id = view.participants.find((x) => x.modelId === "m1")!.id;
    const csvRevisionIds = new Set(csv.revisions.map((r) => r.id));
    const rationales = view.scores.filter((s) => s.evaluatorParticipantId === m1Id && csvRevisionIds.has(s.revisionId)).map((s) => s.rationale);
    expect(rationales.length).toBeGreaterThan(0);
    for (const r of rationales) expect(r).toContain("CSV export");

    // An evaluator that keeps mixing up is rejected: no scores from it, verdict flagged.
    const again = council({
      m1: { title: "Push notifications via service workers", mixedUpEvaluations: Infinity },
      m2: { title: "CSV export without push channel" },
    });
    const second = await start(again.participants);
    await runSession(again.deps, second);
    view = await getSessionView(handle.db, actor, second);
    const matrix = view.decision!.matrix as { confidence: string; failedEvaluators: Array<{ modelId: string; outcome: string }> };
    expect(matrix.failedEvaluators).toEqual([expect.objectContaining({ modelId: "m1", outcome: "invalid_output" })]);
    expect(view.scores.filter((s) => s.evaluatorParticipantId === view.participants.find((x) => x.modelId === "m1")!.id)).toHaveLength(0);
    expect(matrix.confidence).toBe("low");
  });

  it("drops only the mixed-up proposal of an evaluator and keeps its other scores (#145)", async () => {
    const c = council({
      m1: { title: "Monolith", mixesUpTitle: { of: "Serverless", as: "Microservices" } },
      m2: { title: "Microservices" },
      m3: { title: "Serverless" },
      m4: { title: "Event sourcing" },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const m1 = view.participants.find((p) => p.modelId === "m1")!.id;
    const titleOf = (revisionId: string) => (view.proposals.flatMap((p) => p.revisions).find((r) => r.id === revisionId)!.content as { title: string }).title;
    const m1Titles = new Set(view.scores.filter((s) => s.evaluatorParticipantId === m1).map((s) => titleOf(s.revisionId)));
    // One corrective retry, then the mixed-up proposal is dropped – the two correctly bound ones stay.
    expect(c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "evaluation")).toHaveLength(2);
    expect(m1Titles).toEqual(new Set(["Microservices", "Event sourcing"]));
    const matrix = view.decision!.matrix as { failedEvaluators: unknown[]; confidenceIssues: Array<{ kind: string; count?: number }> };
    expect(matrix.failedEvaluators).toEqual([]);
    expect(matrix.confidenceIssues).toContainEqual(expect.objectContaining({ kind: "evaluation_rejected", count: 1 }));
    expect(view.decision!.outcome).not.toBe("insufficient_evidence");
  });

  it("gives no recommendation when fewer than half of the evaluators deliver, and repeats only their evaluation (#145)", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 6) },
      m2: { title: "Microservices", failsEvaluation: true },
      m3: { title: "Serverless", failsEvaluation: true },
      m4: { title: "Event sourcing", failsEvaluation: true },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    let view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("insufficient_evidence");
    const matrix = view.decision!.matrix as { confidenceIssues: Array<{ kind: string; evaluators?: number; expected?: number }> };
    expect(matrix.confidenceIssues).toContainEqual({ kind: "insufficient_evaluators", evaluators: 1, expected: 4 });
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toThrow(/no recommended solution/);

    // The providers recover: only the three models without scores are asked again, m1 is not.
    for (const model of ["m2", "m3", "m4"]) c.adapters.get(model)!.script.failsEvaluation = false;
    const m1Before = c.adapters.get("m1")!.requests.length;
    expect(await submitApproval(handle.db, actor, id, { action: "repeat_evaluation" })).toEqual({ status: "queued" });
    const job = await claimNext(handle.db, 60_000);
    expect(job).not.toBeNull();
    await runSession(c.deps, id);
    view = await getSessionView(handle.db, actor, id);
    expect(c.adapters.get("m1")!.requests.length).toBe(m1Before);
    expect(view.decision!.outcome).toBe("recommended");
    expect((view.decision!.matrix as { failedEvaluators: unknown[] }).failedEvaluators).toEqual([]);
    // Gate version 2: nothing of the frozen round is missing any more – a new evaluation needs a new council.
    await expect(submitApproval(handle.db, actor, id, { action: "repeat_evaluation" })).rejects.toThrow(/No expected evaluator of this round is missing/);
  });

  it("reports the real review depth when a model drops out early or the council is small (#96)", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 6) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 6) },
      m3: { title: "Serverless", fail: true },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    const matrix = view.decision!.matrix as {
      confidence: string;
      confidenceIssues: Array<{ kind: string; modelId?: string; expected?: number; evaluators?: number }>;
    };
    expect(matrix.confidence).toBe("low");
    expect(matrix.confidenceIssues).toContainEqual(expect.objectContaining({ kind: "participant_failed", modelId: "m3" }));
    // A model that dropped out earlier is named, but not counted as an expected evaluator (#151).
    expect(matrix.confidenceIssues.some((i) => i.kind === "missing_evaluators")).toBe(false);
    const report = buildDecisionReport(view);
    expect(report.evaluationMatrix!.confidence).toBe("low");
    expect(report.evaluationMatrix!.confidenceIssues.join(" ")).toContain("m3 dropped out of the council");
    expect(reportToMarkdown(report)).toContain("Low confidence");

    // A council of two models is complete but thin: reduced, not low and not normal.
    const small = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const second = await start(small.participants);
    await runSession(small.deps, second);
    const smallView = await getSessionView(handle.db, actor, second);
    const smallMatrix = smallView.decision!.matrix as { confidence: string; confidenceIssues: Array<{ kind: string }> };
    expect(smallMatrix.confidence).toBe("reduced");
    expect(smallMatrix.confidenceIssues.every((i) => i.kind === "single_evaluator" || i.kind === "unreviewed_objections")).toBe(true);
    expect(reportToMarkdown(buildDecisionReport(smallView))).toContain("Limited review depth");
  });

  it("applies conceded corrections even when the position is kept, and never marks a conceded objection refuted (#94)", async () => {
    const c = council({
      m1: { title: "Monolith", concede: true, hollowRevisions: 1 },
      m2: {
        title: "Microservices",
        critiques: [{ againstTitle: "Monolith", claim: "Invented push thresholds", category: "maintainability", severity: "high" }],
      },
      m3: { title: "Serverless", adjudicate: () => "refuted" },
    });
    const id = await start(c.participants, { consensusRounds: 1 });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const objection = view.objections.find((o) => o.claim === "Invented push thresholds")!;
    // The author conceded – the reviewer's "refuted" does not stand.
    expect(objection.status).toBe("accepted");
    expect(objection.resolutionReason).toContain("Conceded by the author");
    // The first, hollow revision was rejected; the stored one really changes the content.
    const m1Revisions = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "revision");
    expect(m1Revisions).toHaveLength(2);
    expect(m1Revisions[1]!.messages[0]!.content).toContain("identical to the current version");
    const monolith = view.proposals.find((p) => p.revisions.some((r) => (r.content as { title: string }).title === "Monolith"))!;
    const latest = monolith.revisions.at(-1)!;
    expect((latest.content as { summary: string }).summary).toBe("Monolith revised");
    expect(objection.resolutionReason).toContain("Addressed by the author in v2.");
    expect(objection.resolutionReason).toContain("Not independently re-reviewed.");
  });

  it("checks the consensus summary against the current revisions and records which ones it used (#105)", async () => {
    const c = council({ m1: { title: "Monolith", staleSummaries: 1 }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
    const id = await start(c.participants, { consensusRounds: 1 });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const summaries = c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "consensus_summary");
    // One bounded correction with the concrete contradiction, then a clean summary.
    expect(summaries).toHaveLength(2);
    expect(summaries[0]!.messages[0]!.content).toMatch(/<proposal label="[A-Z]" version="\d+">/);
    expect(summaries[1]!.messages[0]!.content).toContain("described measures as missing that the current versions contain");
    expect(view.consensus!.disagreements).toEqual(["storage"]);
    expect(view.consensus!.basedOn.map((r) => r.label).sort()).toEqual(view.proposals.map((p) => p.label).sort());
    expect(view.consensus!.basedOn.every((r) => r.version >= 1)).toBe(true);
  });

  it("keeps a persistent contradiction visible with a quality note instead of passing it as fact (#105)", async () => {
    const c = council({ m1: { title: "Monolith", staleSummaries: Infinity }, m2: { title: "Microservices" } });
    const id = await start(c.participants, { consensusRounds: 1 });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "consensus_summary")).toHaveLength(2);
    expect(view.consensus!.disagreements[0]).toMatch(/\[Quality note: Proposal [A-Z] v\d+ does contain .*not independently verified\.\]$/);
    expect(view.consensus!.disagreements).toContain("storage");
  });

  it("counts a submitted blind proposal immediately without revealing it (#69)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Serverless", proposalGate: gate } });
    const id = await start(c.participants);
    const run = runSession(c.deps, id);
    // Wait until the fast model's proposal is stored while the slow one is still working.
    for (let i = 0; i < 100; i++) {
      if ((await getSessionView(handle.db, actor, id)).submittedCount === 1) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const midway = await getSessionView(handle.db, actor, id);
    expect(midway.submittedCount).toBe(1);
    expect(midway.proposals).toHaveLength(0);
    expect(midway.usage.filter((u) => u.phase === "independent_thinking" && u.outcome === "ok")).toHaveLength(1);
    release();
    await run;
    expect((await getSessionView(handle.db, actor, id)).proposals).toHaveLength(2);
  });

  it("fails honestly when fewer than two proposals arrive", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Broken", fail: true } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("failed");
    expect(view.stages[0]!.status).toBe("failed");
    expect(view.decision).toBeNull();
    // #106: the cause is named and the proposal that did arrive is readable (the council is over).
    expect(view.session.error).toMatch(/^Only 1 of 2 proposals were submitted \(m2: .+\); a council needs at least two/);
    expect(view.proposals).toHaveLength(1);
    expect((view.proposals[0]!.revisions[0]!.content as { title: string }).title).toBe("Monolith");
  });

  it("stops at the token budget server-side", async () => {
    const c = council({ m1: { title: "Monolith", usage: 4_000 }, m2: { title: "Microservices", usage: 4_000 } });
    const id = await start(c.participants, { tokenBudget: 30_000 });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("failed");
    expect(view.session.error).toMatch(/budget/i);
    // Reservations are atomic, so even parallel calls never push the counter past the budget.
    expect(view.session.tokensUsed).toBeLessThanOrEqual(30_000);
  });

  it("keeps the budget for the Final Verdict: debate phases are shortened, the council still ends with a verdict (#148)", async () => {
    const c = council({
      m1: { title: "Monolith", usage: 3_500, score: (t) => (t === "Monolith" ? 9 : 6) },
      m2: { title: "Microservices", usage: 3_500, score: (t) => (t === "Monolith" ? 9 : 6) },
    });
    const id = await start(c.participants, { tokenBudget: BUDGET_FOR_SHORTENED_RUN });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    expect(view.decision!.outcome).toBe("recommended");
    const shortened = view.stages.filter((s) => s.status === "skipped" && /kept for the Final Verdict/.test(s.error ?? ""));
    expect(shortened.length).toBeGreaterThan(0);
    expect(view.stages.find((s) => s.phase === "final_verdict")!.status).toBe("completed");
    const matrix = view.decision!.matrix as { confidence: string; confidenceIssues: Array<{ kind: string }> };
    expect(matrix.confidenceIssues.some((i) => i.kind === "phase_shortened")).toBe(true);
    expect(matrix.confidence).toBe("low");
    expect(reportToMarkdown(buildDecisionReport(view))).toContain("was shortened to keep the token budget for the Final Verdict");
    expect(view.session.tokensUsed).toBeLessThanOrEqual(BUDGET_FOR_SHORTENED_RUN);
  });

  it("requires a confirmation to start when the upper bound exceeds the budget (#148)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" }, m3: { title: "Serverless" }, m4: { title: "Event sourcing" } });
    const input = { mode: "independent_expert" as const, participants: c.participants, tokenBudget: 100_000 };
    const preview = await previewSession(handle.db, actor, projectId, input);
    expect(preview.estimate.withinBudget).toBe(false);
    // No earlier calls in this workspace: no typical value is claimed.
    expect(preview.estimate.typical).toBeNull();
    await expect(createSession(handle.db, actor, projectId, input)).rejects.toThrow(/Minority Review and Consensus Round may be dropped/);
    await expect(createSession(handle.db, actor, projectId, { ...input, confirmBudget: true })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("reports the plan's model limit in the preview, like the start refuses it (#173)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" }, m3: { title: "Serverless" }, m4: { title: "Event sourcing" } });
    const input = { mode: "independent_expert" as const, participants: c.participants };
    expect((await previewSession(handle.db, actor, projectId, input)).planLimit).toBeNull();
    await setSubscriptionPlan(handle.db, "u1", actor.organizationId, "starter");
    const preview = await previewSession(handle.db, actor, projectId, input);
    expect(preview.planLimit).toMatch(/Your plan allows 3 models per session/);
    expect(preview.estimate.calls).toBeGreaterThan(0);
    await expect(createSession(handle.db, actor, projectId, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cancels between calls", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    await handle.db.update(schema.councilSession).set({ status: "running" }).where(eq(schema.councilSession.id, id));
    await cancelSession(handle.db, actor, id);
    await runSession(c.deps, id);
    expect((await getSessionView(handle.db, actor, id)).session.status).toBe("cancelled");
  });

  it("resumes after a crash without repeating finished work", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const callsBefore = [...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0);
    // Simulate a crash during Final Verdict: stage back to running, session running.
    await handle.db.update(schema.councilSession).set({ status: "running" }).where(eq(schema.councilSession.id, id));
    await handle.db.update(schema.workflowStage).set({ status: "running" }).where(eq(schema.workflowStage.phase, "final_verdict"));
    await runSession(c.deps, id);
    const callsAfter = [...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0);
    expect(callsAfter).toBe(callsBefore); // votes already stored → no new evaluation calls
    expect((await getSessionView(handle.db, actor, id)).session.status).toBe("awaiting_approval");
  });

  it("modes change orchestration, not only prompts", async () => {
    const calls: Record<string, number> = {};
    for (const mode of ["independent_expert", "adversarial_review", "consensus"] as const) {
      const c = council({
        m1: { title: "Monolith", critiques: [{ againstTitle: "Microservices", claim: "Too many services", category: "maintainability", severity: "medium" }] },
        m2: { title: "Microservices" },
      });
      const id = await start(c.participants, { mode });
      await runSession(c.deps, id);
      const view = await getSessionView(handle.db, actor, id);
      calls[mode] = [...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0);
      if (mode === "consensus") expect(view.proposals.some((p) => p.kind === "hybrid")).toBe(true);
      if (mode === "adversarial_review") expect(view.messages.some((m) => m.kind === "rebuttal")).toBe(true);
      if (mode === "independent_expert") expect(view.messages.some((m) => m.kind === "rebuttal")).toBe(false);
    }
    expect(calls.adversarial_review).toBeGreaterThan(calls.independent_expert!);
  });

  it("hides proposals before the reveal and authors before the verdict", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    const before = await getSessionView(handle.db, actor, id);
    expect(before.proposals).toHaveLength(0);
    await runSession(c.deps, id);
    expect((await getSessionView(handle.db, actor, id)).proposals.every((p) => p.authorParticipantId)).toBe(true);
  });

  it("enforces the human approval gate", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 5) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 5) },
    });
    const id = await startV1(c.participants);
    await runSession(c.deps, id);
    await expect(submitApproval(handle.db, actor, id, { action: "request_changes" })).rejects.toMatchObject({ code: "VALIDATION" });

    // Members may run councils but not approve them.
    await handle.db.insert(schema.user).values({ id: "u2", name: "Member", email: "m@example.test" });
    await handle.db.insert(schema.membership).values({ id: "mem_u2", organizationId: actor.organizationId, userId: "u2", role: "member" });
    const member = await resolveActor(handle.db, "u2", actor.organizationId);
    await expect(submitApproval(handle.db, member, id, { action: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const more = await submitApproval(handle.db, actor, id, { action: "request_more_debate", comment: "Check costs again" });
    expect(more.status).toBe("queued");
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.debateRoundsRun).toBe(2);
    expect(view.previousDecisions).toHaveLength(1);
    expect(view.proposals[0]!.revisions.length).toBeGreaterThanOrEqual(3);

    const approved = await submitApproval(handle.db, actor, id, { action: "approve", comment: "Go" });
    expect(approved.status).toBe("approved");
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("approves only decisions whose format version it knows; legacy version 1 behaves as before (#181, stage 1)", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 5) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 5) },
    });
    const id = await startV1(c.participants);
    await runSession(c.deps, id);
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    // This release still writes the production gate and marks it as version 1.
    expect(decision!.gateVersion).toBe(1);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decisionStatus).toMatchObject({ gateVersion: 1, readable: true, approvable: true, reason: null, canApproveRecommendation: true });
    const matrix = decision!.matrix as { proposals: Array<{ proposalId: string }> };
    const other = view.proposals.find((p) => p.id !== decision!.recommendedProposalId)!;
    const change = (values: Partial<typeof schema.finalDecision.$inferInsert>) =>
      handle.db.update(schema.finalDecision).set(values).where(eq(schema.finalDecision.id, decision!.id));
    const approve = () => submitApproval(handle.db, actor, id, { action: "approve" });
    const alternative = () => submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: other.id, comment: "Preferred" });

    for (const gateVersion of [3, null]) {
      await change({ gateVersion });
      await expect(approve()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(gateVersion ? /gate version 3/ : /no format version/) });
      await expect(alternative()).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await getSessionView(handle.db, actor, id)).decisionStatus).toMatchObject({
        approvable: false,
        canApproveRecommendation: false,
        approvableProposalIds: [],
      });
    }
    await change({ gateVersion: 1, outcome: "needs_verification", matrix: { ...matrix, outcome: "needs_verification" } });
    await expect(approve()).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(alternative()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Needs verification/) });
    const nv = await getSessionView(handle.db, actor, id);
    expect(nv.decisionStatus).toMatchObject({ approvable: false, reason: expect.stringMatching(/^Needs verification/) });
    expect(reportToMarkdown(buildDecisionReport(nv))).toContain("**Not approvable:**");
    expect(buildDecisionReport(nv).decisionFormat).toMatchObject({ gateVersion: 1, approvable: false });

    // Missing entry of the selected proposal, and contradictory row/matrix fields.
    await change({ outcome: "recommended", matrix: { ...matrix, proposals: matrix.proposals.filter((p) => p.proposalId !== other.id) } });
    await expect(alternative()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/not part of the stored verdict/) });
    await change({ matrix: { ...matrix, recommendedProposalId: other.id } });
    await expect(approve()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/contradicts itself/) });

    // Back to the consistent legacy decision: approvable as in production.
    await change({ matrix });
    expect((await approve()).status).toBe("approved");
  });

  it("an older release never re-evaluates a council with a newer gate version (#181, stage 1)", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 5) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 5) },
    });
    const id = await startV1(c.participants);
    await runSession(c.deps, id);
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    await handle.db.update(schema.finalDecision).set({ gateVersion: 3 }).where(eq(schema.finalDecision.id, decision!.id));
    await expect(submitApproval(handle.db, actor, id, { action: "request_more_debate", comment: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/gate version 3/),
    });
    await expect(submitApproval(handle.db, actor, id, { action: "repeat_evaluation" })).rejects.toMatchObject({
      message: expect.stringMatching(/gate version 3/),
    });
    // A job that is queued anyway (e.g. enqueued by the newer release before a rollback) fails before any model call.
    await handle.db.update(schema.councilSession).set({ status: "queued" }).where(eq(schema.councilSession.id, id));
    await handle.db.update(schema.workflowStage).set({ status: "pending" }).where(eq(schema.workflowStage.sessionId, id));
    const calls = [...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("failed");
    expect(view.session.error).toMatch(/gate version 3.*must not run or re-evaluate/);
    expect([...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0)).toBe(calls);
    // The newer decision stays untouched – no silent downgrade, no new version-1 decision.
    const decisions = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    expect(decisions.map((d) => [d.gateVersion, d.supersededAt])).toEqual([[3, null]]);
  });

  it("never runs a council started for a newer gate version, even before any verdict exists (#181, stage 1b)", async () => {
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Monolith" ? 9 : 5) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 5) },
    });
    const id = await start(c.participants);
    const [created] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    // This release starts councils for the gate it computes.
    expect(created!.gateVersion).toBe(2);
    // Queued by a newer release before a rollback: no decision yet, only the session knows its version.
    await handle.db.update(schema.councilSession).set({ gateVersion: 3 }).where(eq(schema.councilSession.id, id));
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("failed");
    expect(view.session.error).toMatch(/gate version 3.*must not run or re-evaluate/);
    expect([...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0)).toBe(0);
    expect(await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id))).toHaveLength(0);
  });

  it("types a unanimous negative finding as no solution: no approval, no alternative, the finding can be confirmed (#121)", async () => {
    // Contradictory hard requirements; every model explains why nothing can satisfy them, and scores high.
    const c = council({
      m1: { title: "No architecture under H1–H3", unsolvable: true, judgesUnsolvable: true, score: () => 9 },
      m2: { title: "Neither LOCAL nor CENTRAL", unsolvable: true, judgesUnsolvable: true, score: () => 9 },
      m3: { title: "Keine geeignete Loesung", unsolvable: true, judgesUnsolvable: true, score: () => 10 },
    });
    const id = await startV1(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    expect(view.decision!.outcome).toBe("no_qualifying_solution");
    expect(view.decision!.recommendedProposalId).toBeNull();
    const matrix = view.decision!.matrix as {
      requirementsConflict: boolean;
      proposals: Array<{ implementable: boolean; total: number; requirementChecks: { failed: number; total: number } }>;
    };
    expect(matrix.requirementsConflict).toBe(true);
    expect(matrix.proposals.every((p) => !p.implementable && p.total >= 9 && p.requirementChecks.failed === 2)).toBe(true);

    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: view.proposals[0]!.id, comment: "Build it anyway" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/not an implementable solution/) });

    // UI, JSON and Markdown carry the same status.
    const report = buildDecisionReport(view);
    expect(report.requirementsConflict).toBe(true);
    expect(report.outcomeText).toMatch(/No solution can meet these requirements/);
    expect(report.requirementConflicts.length).toBeGreaterThan(0);
    expect(report.evaluationMatrix!.proposals.every((p) => !p.implementable && !p.eligible)).toBe(true);
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("### Conflicting requirements");
    expect(markdown).toContain("| Implementable |");

    // Confirming the finding is a rejection: recorded, and nothing can be approved or built afterwards.
    const confirmed = await submitApproval(handle.db, actor, id, { action: "reject", comment: "Finding confirmed – H1 and H2 contradict" });
    expect(confirmed.status).toBe("rejected");
  });

  it("stops only the model whose key is deleted during the run – clear reason, no fallback key, no leaked budget (#30)", async () => {
    const second = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", label: "second", secret: "sk-ant-test-1111111111111111" })).id;
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
    const real = credentialAdapterResolver(handle.db, keyring);
    let m3Resolves = 0;
    const deps = {
      ...c.deps,
      // The real resolver decides whether the key still exists; the answers come from the scripted models.
      resolveAdapter: async (p: Parameters<typeof real>[0]) => {
        if (p.modelId === "m3" && ++m3Resolves === 2) await deleteCredential(handle.db, actor, second);
        await real(p);
        return c.adapters.get(p.modelId)!;
      },
    };
    const id = await start([
      { credentialId, modelId: "m1" },
      { credentialId, modelId: "m2" },
      { credentialId: second, modelId: "m3" },
    ]);
    await runSession(deps, id);
    const view = await getSessionView(handle.db, actor, id);
    // The council continues with the two remaining models.
    expect(view.session.status).toBe("awaiting_approval");
    const m3 = view.participants.find((p) => p.modelId === "m3")!;
    expect(m3.status).toBe("failed");
    expect(m3.failureReason).toMatch(/No usable API key for anthropic: The API key of this participant was deleted/);
    // No fallback: after the deletion m3's model is never asked again (with this or any other key).
    expect(c.adapters.get("m3")!.requests).toHaveLength(1);
    expect(view.usage.some((u) => u.participantId === m3.id && u.outcome === "error")).toBe(true);
    // The reservation of the failed call was released: the budget counts exactly the recorded usage.
    const [row] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    const recorded = view.usage.reduce((n, u) => n + u.inputTokens + u.outputTokens, 0);
    expect(row!.tokensUsed).toBe(recorded);
  });

  it("records a rejection and allows no build or further approval afterwards (#44, #55)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const rejected = await submitApproval(handle.db, actor, id, { action: "reject", comment: "Not worth it" });
    expect(rejected.status).toBe("rejected");
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    const view = await getSessionView(handle.db, actor, id);
    expect(view.approvals.map((a) => [a.action, a.comment])).toEqual([["reject", "Not worth it"]]);
    expect(reportToMarkdown(buildDecisionReport(view))).toContain("reject");
  });

  it("limits how many councils run at the same time in one workspace (#7)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    for (let i = 0; i < 3; i++) await start(c.participants);
    await expect(start(c.participants)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("At most 3 councils") });
  });

  it("isolates tenants and validates configuration", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    await handle.db.insert(schema.user).values({ id: "x", name: "Other", email: "x@example.test" });
    const other = await resolveActor(handle.db, "x", (await createOrganization(handle.db, "x", { name: "Other org" })).id);
    await expect(getSessionView(handle.db, other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createSession(handle.db, other, projectId, { mode: "consensus", participants: c.participants })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(start([{ credentialId, modelId: "m1" }])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      start([
        { credentialId, modelId: "m1" },
        { credentialId, modelId: "m1" },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Image/video models are refused server-side, also in the preflight (#118).
    const media = [
      { credentialId, modelId: "m1" },
      { credentialId, modelId: "grok-imagine-image" },
    ];
    await expect(start(media)).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringMatching(/grok-imagine-image is an image, video or audio model/),
    });
    await expect(previewSession(handle.db, actor, projectId, { mode: "independent_expert", participants: media })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      start(c.participants, { weights: { technicalQuality: 50, security: 50, maintainability: 50, operatingCost: 0, implementationSpeed: 0 } }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const preview = await previewSession(handle.db, actor, projectId, { mode: "adversarial_review", participants: c.participants });
    expect(preview.estimate.calls).toBeGreaterThan(10);
  });

  it("runs councils of two workspaces and a build at the same time, fairly between workspaces (#149)", async () => {
    // Both councils hold their proposals until the other one is running too: with a single job loop this deadlocks.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = council({ m1: { title: "Monolith", proposalGate: gate }, m2: { title: "Microservices" } });
    const firstId = await start(first.participants);
    const otherUser = await handle.db.insert(schema.user).values({ id: "u2", name: "Other", email: "u2@example.test" }).returning();
    const otherOrg = await ensurePersonalOrganization(handle.db, otherUser[0]!.id, "Other");
    const other = await resolveActor(handle.db, "u2", otherOrg.id);
    await setSubscriptionPlan(handle.db, "u2", otherOrg.id, "business");
    const otherProject = (await createProject(handle.db, other, { name: "Other", type: "architecture", brief: { idea: "Another workspace's question." } })).id;
    await confirmProposedRequirements(handle.db, other, otherProject);
    const otherKey = (await createCredential(handle.db, other, keyring, { provider: "anthropic", secret: "sk-ant-test-1111111111111111" })).id;
    const second = new Map([
      ["m3", new ScriptedAdapter({ title: "Serverless", proposalGate: gate })],
      ["m4", new ScriptedAdapter({ title: "Event sourcing" })],
    ]);
    const secondId = (
      await createSession(handle.db, other, otherProject, {
        mode: "independent_expert",
        participants: [...second.keys()].map((modelId) => ({ credentialId: otherKey, modelId })),
        confirmBudget: true,
      })
    ).id;
    // A build job of the first workspace (a stand-in handler: only its start matters here).
    await enqueue(handle.db, "execution.run", { planId: "plan_test" }, "execution.run:plan_test", actor.organizationId);
    let buildStarted = false;
    const adapters = new Map([...first.adapters, ...second]);
    const controller = new AbortController();
    const worker = runWorker({
      db: handle.db,
      signal: controller.signal,
      pollMs: 20,
      concurrency: 4,
      handlers: {
        "council.run": async (job) =>
          runSession({ db: handle.db, resolveAdapter: async (p) => adapters.get(p.modelId)!, random: () => 0.5 }, String(job.payload.sessionId)),
        "execution.run": async () => {
          buildStarted = true;
        },
      },
    });
    const statusOf = async (id: string) => (await getSessionView(handle.db, id === firstId ? actor : other, id)).session.status;
    for (let i = 0; i < 200 && ((await statusOf(firstId)) !== "running" || (await statusOf(secondId)) !== "running" || !buildStarted); i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(await statusOf(firstId)).toBe("running");
    expect(await statusOf(secondId)).toBe("running");
    expect(buildStarted).toBe(true);
    release();
    for (let i = 0; i < 400 && ((await statusOf(firstId)) !== "awaiting_approval" || (await statusOf(secondId)) !== "awaiting_approval"); i++)
      await new Promise((r) => setTimeout(r, 25));
    controller.abort();
    await worker;
    expect(await statusOf(firstId)).toBe("awaiting_approval");
    expect(await statusOf(secondId)).toBe("awaiting_approval");
  }, 30_000);

  it("lets a workspace at its limit wait while another workspace's job runs first (#149)", async () => {
    const org = actor.organizationId;
    const otherOrg = (await createOrganization(handle.db, "u1", { name: "Second workspace" })).id;
    for (const n of [1, 2]) await enqueue(handle.db, "council.run", { sessionId: `a${n}` }, `a${n}`, org);
    await enqueue(handle.db, "council.run", { sessionId: "b1" }, "b1", otherOrg);
    // One job per workspace: after a1, the next claim skips a2 and takes the other workspace's b1.
    const firstJob = await claimNext(handle.db, 60_000, { perWorkspace: 1 });
    const secondJob = await claimNext(handle.db, 60_000, { perWorkspace: 1 });
    expect(firstJob?.payload.sessionId).toBe("a1");
    expect(secondJob?.payload.sessionId).toBe("b1");
    expect(await claimNext(handle.db, 60_000, { perWorkspace: 1 })).toBeNull();
    // A limit per kind holds back further builds.
    await enqueue(handle.db, "execution.run", { planId: "p1" }, "p1");
    await enqueue(handle.db, "execution.run", { planId: "p2" }, "p2");
    const build = await claimNext(handle.db, 60_000, { perWorkspace: 1, perKind: { "execution.run": 1 } });
    expect(build?.payload.planId).toBe("p1");
    expect(await claimNext(handle.db, 60_000, { perWorkspace: 1, perKind: { "execution.run": 1 } })).toBeNull();
    await completeJob(handle.db, firstJob!.id);
    expect((await claimNext(handle.db, 60_000, { perWorkspace: 1, perKind: { "execution.run": 1 } }))?.payload.sessionId).toBe("a2");
  });

  it("reads the worker capacity from the environment (#149)", () => {
    expect(workerCapacityFromEnv({}, "execution.run")).toEqual({ concurrency: 4, limits: { perWorkspace: 3, perKind: { "execution.run": 2 } } });
    expect(workerCapacityFromEnv({ WORKER_CONCURRENCY: "8", WORKER_JOBS_PER_WORKSPACE: "2", WORKER_MAX_BUILDS: "x" }, "execution.run")).toEqual({
      concurrency: 8,
      limits: { perWorkspace: 2, perKind: { "execution.run": 2 } },
    });
  });

  it("refuses invented, foreign, duplicate and unassignable models before any provider is called (#144)", async () => {
    const catalog = async () => ["gpt-4o-mini", "claude-haiku-5-5"];
    const create = (participants: SessionInput["participants"], extra: Partial<SessionInput> = {}) =>
      createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true, ...extra }, catalog);
    const ok = { credentialId, modelId: "gpt-4o-mini" };
    await expect(create([ok, { credentialId, modelId: "gpt-does-not-exist-9" }])).rejects.toThrow(
      /Not available for the selected API key: gpt-does-not-exist-9/,
    );
    // Duplicates are compared case-insensitively after trimming.
    await expect(create([ok, { credentialId, modelId: " GPT-4o-mini " }])).rejects.toThrow(/only once/);
    // #249 review: the same model through a second key of the same provider is no second independent evaluator.
    const secondKey = (
      await createCredential(handle.db, actor, keyring, { provider: "anthropic", label: "second key", secret: "sk-ant-test-2222222222222222" })
    ).id;
    await expect(create([ok, { credentialId: secondKey, modelId: "gpt-4o-mini" }])).rejects.toThrow(/only once – also with a second API key/);
    await expect(
      create([ok, { credentialId, modelId: "claude-haiku-5-5" }], {
        roles: ["software_architect"],
        roleAssignments: [{ role: "security_expert", participantIndex: 0 }],
      }),
    ).rejects.toThrow(/not part of this council's roles/);
    const jobs = await handle.db.select().from(schema.job);
    expect(jobs).toHaveLength(0);
    // The provider's own spelling is stored; a key whose models cannot be listed is not checked.
    const { id } = await create([
      { credentialId, modelId: "GPT-4O-MINI" },
      { credentialId, modelId: "claude-haiku-5-5" },
    ]);
    expect((await getSessionView(handle.db, actor, id)).participants.map((p) => p.modelId)).toEqual(["gpt-4o-mini", "claude-haiku-5-5"]);
    await expect(
      createSession(
        handle.db,
        actor,
        projectId,
        {
          mode: "independent_expert",
          participants: [
            { credentialId, modelId: "x-1" },
            { credentialId, modelId: "x-2" },
          ],
          confirmBudget: true,
        },
        async () => null,
      ),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("refuses a listed model that answers 'model not found' to the start check; an unclear check never blocks", async () => {
    const listed = async () => ["gpt-4o-mini", "claude-haiku-5-5"];
    const probed: string[] = [];
    const withProbe = (result: (modelId: string) => "ok" | "not_found" | "unknown") =>
      Object.assign(listed, {
        probe: async (_credentialId: string, modelId: string) => {
          probed.push(modelId);
          return result(modelId);
        },
      });
    const participants = [
      { credentialId, modelId: "gpt-4o-mini" },
      { credentialId, modelId: "claude-haiku-5-5" },
    ];
    const start = (catalog: Parameters<typeof createSession>[4]) =>
      createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true }, catalog);
    const before = (await handle.db.select().from(schema.councilSession)).length;
    await expect(start(withProbe((m) => (m === "claude-haiku-5-5" ? "not_found" : "ok")))).rejects.toThrow(
      /refuses calls with your key \(HTTP 404\): claude-haiku-5-5/,
    );
    expect(probed).toEqual(["gpt-4o-mini", "claude-haiku-5-5"]);
    expect(await handle.db.select().from(schema.councilSession)).toHaveLength(before);
    // Timeout, rate limit or a provider outage say nothing about the model: the start goes ahead.
    const { id } = await start(withProbe(() => "unknown"));
    expect(id).toEqual(expect.any(String));
    // Keeps the concurrent-session limit free for the following tests.
    await handle.db.delete(schema.councilSession).where(eq(schema.councilSession.id, id));
  });

  it("fixes vote weights at the start – the user's value or the catalog suggestion – and uses them in the verdict (#140)", async () => {
    // Test catalog (made-up scores): m1 is the strongest of three entries, m2 the weakest; m3 has no entry.
    await handle.db.insert(schema.modelStrengthSync).values({
      id: "mss_test",
      source: "Test ranking",
      sourceUrl: "https://example.test",
      ok: true,
      entries: [
        { sourceModelId: "1", slug: "m1", name: "m1", creator: "Anthropic", score: 70 },
        { sourceModelId: "2", slug: "x", name: "x", creator: "Anthropic", score: 50 },
        { sourceModelId: "3", slug: "m2", name: "m2", creator: "Anthropic", score: 20 },
      ],
    });
    const c = council({
      m1: { title: "Monolith", score: (t) => (t === "Serverless" ? 9 : 6) },
      m2: { title: "Microservices", score: (t) => (t === "Monolith" ? 9 : 6) },
      m3: { title: "Serverless", score: (t) => (t === "Monolith" ? 9 : 6) },
    });
    const preview = await previewSession(handle.db, actor, projectId, { mode: "independent_expert", participants: c.participants });
    expect(preview.voteWeights.map((w) => [w.weight, w.suggestion.status])).toEqual([
      [10, "known"],
      [1, "known"],
      [5, "unknown"],
    ]);
    // Suggested 10/1/5: m1 holds 63 % of the vote – warned before the start, not capped (#170).
    expect(preview.voteWeightWarnings).toMatchObject([{ kind: "dominant_share", model: "m1", sharePercent: 63 }]);
    // The user overrides m3; m1 and m2 keep the suggestion.
    const id = await start([c.participants[0]!, c.participants[1]!, { ...c.participants[2]!, voteWeight: 7 }]);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.participants.map((p) => p.voteWeight)).toEqual([10, 1, 7]);
    expect((view.participants[2]!.voteWeightSuggestion as { tier: number }).tier).toBe(5);
    const matrix = view.decision!.matrix as { evaluatorWeights: Record<string, number>; formula: string };
    expect(view.participants.map((p) => matrix.evaluatorWeights[p.id])).toEqual([10, 1, 7]);
    expect(matrix.formula).toContain("vote-weighted");
    expect(reportToMarkdown(buildDecisionReport(view))).toContain("Vote weights: anthropic/m1 10/10, anthropic/m2 1/10, anthropic/m3 7/10 (suggested 5)");
  });

  it("queues exactly one job per start and recovers stale locks", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants);
    // A queued session says why it waits (#149).
    expect((await getSessionView(handle.db, actor, id)).queue).toEqual({ ahead: 0, running: 0, runningInWorkspace: 0 });
    const job = await claimNext(handle.db, 50);
    expect(job?.kind).toBe("council.run");
    expect(await claimNext(handle.db, 50)).toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    const reclaimed = await claimNext(handle.db, 50);
    expect(reclaimed?.id).toBe(job!.id);
    expect(reclaimed?.attempts).toBe(2);
    await completeJob(handle.db, job!.id);
    expect(await claimNext(handle.db, 50)).toBeNull();
  });
});

describe("documents and session rules", () => {
  it("freezes attached documents into the brief and appends user rules to every system prompt", async () => {
    const { addDocument } = await import("@consyrion/db");
    await addDocument(handle.db, actor, projectId, {
      name: "requirements.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode("# Must run in the EU"),
    });
    await expect(addDocument(handle.db, actor, projectId, { name: "photo.png", mimeType: "image/png", bytes: new Uint8Array([1, 2]) })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" } });
    const id = await start(c.participants, { customRules: "Focus on operating cost." });
    await runSession(c.deps, id);
    const first = c.adapters.get("m1")!.requests[0]!;
    expect(first.messages[0]!.content).toContain('<document name="requirements.md">');
    expect(first.messages[0]!.content).toContain("Must run in the EU");
    expect(c.adapters.get("m2")!.requests.every((r) => r.system!.includes("Focus on operating cost."))).toBe(true);
  });
});

describe("objection hygiene", () => {
  it("records one objection per model and claim even if several roles repeat it", async () => {
    const c = council({
      m1: { title: "Monolith" },
      m2: { title: "Microservices", critiques: [{ againstTitle: "Monolith", claim: "Will not scale", category: "performance", severity: "high" }] },
      m3: { title: "Serverless" },
    });
    const id = await start(c.participants, { mode: "adversarial_review" }); // 12 roles → m2 has 4 roles, 2 rounds
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections.filter((o) => o.claim === "Will not scale")).toHaveLength(1);
    expect(view.messages.filter((m) => m.kind === "critique" && m.body === "Will not scale").length).toBeGreaterThan(1);
  });
});

describe("provider failures and output limits (#172, #175)", () => {
  const usageOf = async (sessionId: string) => handle.db.select().from(schema.usageRecord).where(eq(schema.usageRecord.sessionId, sessionId));

  it("starts a participant's later calls with the raised limit after it was cut off once (#172)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices", truncatedProposals: 1 } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const m2 = c.adapters.get("m2")!.requests;
    const repaired = m2.filter((r) => r.jsonSchema!.name === "proposal")[1]!.maxOutputTokens;
    // Every later call of m2 starts at the raised limit instead of being cut off again; m1 keeps its own limit.
    expect(m2.filter((r) => r.jsonSchema!.name !== "proposal").every((r) => r.maxOutputTokens >= repaired)).toBe(true);
    expect(c.adapters.get("m1")!.requests.find((r) => r.jsonSchema!.name === "open_council")!.maxOutputTokens).toBeLessThan(repaired);
  });

  it("asks a repeating runaway answer again with a length instruction instead of doubling the limit (#175)", async () => {
    const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices", runawayProposals: 1 } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const proposals = c.adapters.get("m2")!.requests.filter((r) => r.jsonSchema!.name === "proposal");
    expect(proposals).toHaveLength(2);
    expect(proposals[1]!.maxOutputTokens).toBe(proposals[0]!.maxOutputTokens);
    expect(proposals[1]!.messages[0]!.content).toContain("kept repeating the same text");
    const kinds = (await usageOf(id)).filter((u) => u.phase === "independent_thinking" && u.outcome !== "ok").map((u) => u.errorKind);
    expect(kinds).toEqual(["runaway"]);
  });

  it("detects repetitive output cheaply and leaves long distinct answers alone", () => {
    const distinct = Array.from({ length: 80 }, (_, i) => `Point ${i}: component ${i * 7} handles case ${i * 13} with its own reasoning.`).join(" ");
    expect(looksRepetitive(distinct)).toBe(false);
    expect(looksRepetitive(`{"summary": "${"The same sentence again and again without end. ".repeat(100)}`)).toBe(true);
    expect(looksRepetitive(`{"summary": "ok"${" ".repeat(5_000)}`)).toBe(true);
    expect(looksRepetitive("short")).toBe(false);
  });

  it("marks the roles of a model that stays down as failed, stops calling it in that phase and finishes the council (#175)", async () => {
    const c = council({
      m1: { title: "Monolith" },
      m2: { title: "Microservices" },
      m3: { title: "Serverless", unavailableFor: ["role_review", "rebuttals"] },
    });
    // Adversarial Review: 12 roles (4 per model), 2 rounds with rebuttals.
    const id = await start(c.participants, { mode: "adversarial_review" });
    await runSession({ ...c.deps, transientRetryDelayMs: 20 }, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    const m3 = view.participants.find((p) => p.modelId === "m3")!;
    const reviews = c.adapters.get("m3")!.requests.filter((r) => r.jsonSchema!.name === "role_review");
    // Round 1: 4 roles × (3 quick tries + 3 after the pause). Round 2 and the rebuttals are not sent at all.
    expect(reviews.length).toBeLessThanOrEqual(24);
    expect(reviews.some((r) => r.messages[0]!.content.includes("(round 2)"))).toBe(false);
    expect(c.adapters.get("m3")!.requests.some((r) => r.jsonSchema!.name === "rebuttals")).toBe(false);
    const failedRoles = view.messages.filter((m) => m.kind === "role_failed" && m.participantId === m3.id);
    expect(failedRoles.filter((m) => m.round === 1)).toHaveLength(4);
    expect(failedRoles.filter((m) => m.round === 2)).toHaveLength(4);
    expect(failedRoles.filter((m) => m.round === 2).every((m) => m.body.startsWith("skipped"))).toBe(true);
    expect(failedRoles.every((m) => m.evidence === "overloaded")).toBe(true);
    // The error kind is stored and summarised per model.
    const m3Errors = (await usageOf(id)).filter((u) => u.participantId === m3.id && u.outcome === "error");
    expect(m3Errors.every((u) => u.errorKind === "overloaded" && u.httpStatus === 503)).toBe(true);
    expect(view.callFailures.find((f) => f.participantId === m3.id)).toMatchObject({ lastErrorKind: "overloaded", lastHttpStatus: 503 });
    // No contribution to the main debate is a confidence issue of the verdict.
    const matrix = view.decision!.matrix as { confidence: string; confidenceIssues: Array<{ kind: string; modelId?: string }> };
    expect(matrix.confidenceIssues).toContainEqual(expect.objectContaining({ kind: "no_debate_contribution", modelId: "m3" }));
    expect(matrix.confidence).toBe("low");
    // The next start screen warns about the model from this workspace's own usage rows.
    const preview = await previewSession(handle.db, actor, projectId, { mode: "adversarial_review", participants: c.participants });
    expect(preview.modelWarnings).toEqual([expect.stringMatching(/^m3: \d+ of \d+ calls .* failed \(mostly overloaded\) – with three or fewer models/)]);
  }, 30_000);

  it("marks objections as not defended when the author's model failed, not as uncontested (#175)", async () => {
    const c = council({
      m1: { title: "Monolith", critiques: [{ againstTitle: "Serverless", claim: "Cold starts break the SLA", category: "performance", severity: "high" }] },
      m2: { title: "Microservices" },
      m3: { title: "Serverless", unavailableFor: ["objection_responses"] },
    });
    const id = await start(c.participants);
    await runSession({ ...c.deps, transientRetryDelayMs: 20 }, id);
    const view = await getSessionView(handle.db, actor, id);
    const objection = view.objections.find((o) => o.claim === "Cold starts break the SLA")!;
    expect(objection.response).toBeNull();
    expect(objection.undefendedReason).toBe("provider error (overloaded)");
    // The judge is told why there is no answer.
    const judged = c.adapters.get("m2")!.requests.find((r) => r.jsonSchema!.name === "adjudication")!;
    expect(judged.messages[0]!.content).toContain("the author could not answer (provider error (overloaded))");
    const matrix = view.decision!.matrix as { confidenceIssues: Array<{ kind: string }> };
    expect(matrix.confidenceIssues).toContainEqual(expect.objectContaining({ kind: "undefended_proposal", count: 1 }));
    const markdown = reportToMarkdown(buildDecisionReport(view));
    expect(markdown).toContain("NOT DEFENDED – provider error (overloaded)");
    expect(markdown).toContain("was not defended – provider error (overloaded)");
  }, 30_000);
});

describe("batched, parallel adjudication (#184)", () => {
  const critiquesOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ againstTitle: "Microservices", claim: `Gap ${i + 1} in the design`, category: "performance", severity: "high" }));
  const adjudications = (adapter: ScriptedAdapter) => adapter.requests.filter((r) => r.jsonSchema!.name === "adjudication");
  const objectionsIn = (request: GenerateRequest) => (request.messages[0]!.content.match(/<objection id=/g) ?? []).length;
  const idOf = (view: Awaited<ReturnType<typeof getSessionView>>, modelId: string) => view.participants.find((p) => p.modelId === modelId)!.id;

  it("splits many objections into batches of the batch size and decides every one", async () => {
    const c = council({ m1: { title: "Monolith", critiques: critiquesOf(40) }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections).toHaveLength(40);
    expect(view.objections.every((o) => o.status === "refuted" && o.reviewedByParticipantId === idOf(view, "m3"))).toBe(true);
    // m3 is the only independent judge (m1 raised, m2 wrote): 40 objections → 4 calls of at most 12.
    const calls = adjudications(c.adapters.get("m3")!);
    expect(calls).toHaveLength(Math.ceil(40 / ADJUDICATION_BATCH_SIZE));
    expect(calls.every((r) => objectionsIn(r) <= ADJUDICATION_BATCH_SIZE)).toBe(true);
    expect(calls.reduce((sum, r) => sum + objectionsIn(r), 0)).toBe(40);
    // Each batch carries only the proposals it is about.
    expect(calls.every((r) => !r.messages[0]!.content.includes('"title": "Serverless"'))).toBe(true);
  }, 30_000);

  it("gives the batches of a failing judge to another eligible judge, and the phase finishes", async () => {
    const c = council({
      m1: { title: "Monolith", critiques: critiquesOf(30) },
      m2: { title: "Microservices" },
      m3: { title: "Serverless", unavailableFor: ["adjudication"] },
      m4: { title: "Event sourcing" },
    });
    const id = await start(c.participants);
    await runSession({ ...c.deps, transientRetryDelayMs: 20 }, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.session.status).toBe("awaiting_approval");
    expect(view.objections).toHaveLength(30);
    expect(view.objections.every((o) => o.status === "refuted" && o.reviewedByParticipantId === idOf(view, "m4"))).toBe(true);
    // m3 got its first share once (2 parallel batches, each with its quick and late retries) and no batch after that.
    const m3Batches = new Set(adjudications(c.adapters.get("m3")!).map((r) => r.messages[0]!.content));
    expect(m3Batches.size).toBe(2);
    expect(adjudications(c.adapters.get("m4")!).reduce((sum, r) => sum + objectionsIn(r), 0)).toBe(30);
  }, 30_000);

  it("ends objections without an available judge as unresolved with the reason, never as open or closed", async () => {
    const c = council({
      m1: { title: "Monolith", critiques: critiquesOf(20) },
      m2: { title: "Microservices" },
      m3: { title: "Serverless", unavailableFor: ["adjudication"] },
    });
    const id = await start(c.participants);
    await runSession({ ...c.deps, transientRetryDelayMs: 20 }, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections).toHaveLength(20);
    for (const o of view.objections) {
      expect(o.status).toBe("unresolved");
      expect(o.resolutionReason).toContain("No independent reviewer was available – provider error (overloaded) for every eligible judge");
    }
  }, 30_000);

  it("runs judges and their batches in parallel", async () => {
    const c = council({
      m1: { title: "Monolith", critiques: critiquesOf(48) },
      m2: { title: "Microservices" },
      m3: { title: "Serverless", adjudicationDelayMs: 150 },
      m4: { title: "Event sourcing", adjudicationDelayMs: 150 },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.objections.every((o) => o.status === "refuted")).toBe(true);
    const m3 = c.adapters.get("m3")!;
    const m4 = c.adapters.get("m4")!;
    // 48 objections, 24 per judge → 2 batches each, all four in flight at once instead of one after another.
    expect(adjudications(m3)).toHaveLength(2);
    expect(adjudications(m4)).toHaveLength(2);
    expect(Math.min(m3.maxParallelAdjudications, m4.maxParallelAdjudications)).toBe(Math.min(2, JUDGE_PARALLEL_CALLS));
    const spans = [...m3.adjudicationSpans, ...m4.adjudicationSpans];
    const wall = Math.max(...spans.map((s) => s.end)) - Math.min(...spans.map((s) => s.start));
    // Sequential calls would take at least 4 × 150 ms.
    expect(wall).toBeLessThan(450);
  }, 30_000);

  it("keeps the budget gate per batch: once the budget is spent no further batch is sent and the phase is shortened", async () => {
    let id = "";
    let frozen = false;
    const c = council({
      m1: { title: "Monolith", critiques: critiquesOf(40) },
      m2: { title: "Microservices" },
      m3: {
        title: "Serverless",
        // While the first batch is answered the remaining budget drops to zero.
        beforeAdjudication: async () => {
          if (frozen) return;
          frozen = true;
          const [row] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
          await handle.db.update(schema.councilSession).set({ tokenBudget: row!.tokensUsed }).where(eq(schema.councilSession.id, id));
        },
      },
    });
    id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const calls = adjudications(c.adapters.get("m3")!);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(Math.ceil(40 / ADJUDICATION_BATCH_SIZE));
    expect(view.stages.find((s) => s.phase === "minority_review")).toMatchObject({ status: "skipped", error: expect.stringMatching(/^Shortened/) });
    expect(view.session.tokensUsed).toBeLessThanOrEqual(view.session.tokenBudget);
    // Batches answered before the gate closed are stored as decided; the rest stays open – nothing is closed silently.
    const decided = calls.reduce((sum, r) => sum + objectionsIn(r), 0);
    expect(view.objections.filter((o) => o.status === "refuted")).toHaveLength(decided);
    expect(view.objections.filter((o) => o.status === "open")).toHaveLength(40 - decided);
  }, 30_000);
});
