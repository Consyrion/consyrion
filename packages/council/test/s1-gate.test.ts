/**
 * S1 requirement gate orchestration (#181, gate version 2) with the public TEST engine. The product rules are tested in
 * the engine; these tests check what the application owns: the frozen round, append-only raw checks, binding
 * of checks to round/proposal/requirement, the engine as the only feasibility authority, and the locks around a
 * version-2 verdict (approval, more debate, repeat evaluation).
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  setSubscriptionPlan,
  updateBrief,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { engine } from "@consyrion/engine";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDecisionReport,
  createSession,
  getSessionView,
  previewFollowUp,
  previewSession,
  runSession,
  startFollowUp,
  submitApproval,
  type SessionInput,
} from "../src";
import { assertGateResultConsistent } from "../src/requirement-gate";
import { ScriptedAdapter, type Script } from "./scripted-adapter";
import { confirmProposedRequirements } from "./confirm-requirements";

let handle: DatabaseHandle;
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
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  projectId = (
    await createProject(handle.db, actor, {
      name: "Clinic SaaS",
      type: "architecture",
      brief: {
        idea: "Design a scheduling SaaS for 120 clinics.",
        requirements: "Health data must stay in Germany. Running costs must not exceed 300 EUR per month. Go-live within 4 months.",
      },
    })
  ).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
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
    participants: Object.keys(scripts).map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"],
  };
}

async function start(participants: SessionInput["participants"]) {
  const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true });
  return id;
}

const rounds = (id: string) => handle.db.select().from(schema.evaluationRound).where(eq(schema.evaluationRound.sessionId, id));
const checks = (id: string) => handle.db.select().from(schema.requirementCheck).where(eq(schema.requirementCheck.sessionId, id));
const requests = (c: ReturnType<typeof council>) => [...c.adapters.values()].reduce((n, a) => n + a.requests.length, 0);
const scores = (t: string) => (t === "Monolith" ? 9 : 6);
/**
 * Enough for the Final Verdict of three models with six requirements, too little for every debate phase. With a reserve
 * sized for scorecards only, this budget ends the council `failed` in the Final Verdict.
 */
const TIGHT_S1_BUDGET = 112_000;

describe("S1 gate orchestration (#181, gate version 2)", () => {
  it("freezes the round before the first evaluation, stores every raw check and writes a version-2 verdict", async () => {
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } });
    const id = await start(c.participants);
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    expect(session!.gateVersion).toBe(3);
    await runSession(c.deps, id);

    const [round] = await rounds(id);
    expect(round!.requirementIds.length).toBeGreaterThanOrEqual(3);
    expect(round!.requirementListId).toBe(session!.requirementListId);
    for (const p of round!.proposals) {
      expect(p.expectedEvaluatorIds).toHaveLength(2);
      expect(p.expectedEvaluatorIds).not.toContain(p.authorParticipantId);
    }
    // 3 evaluators × 2 proposals each × every requirement, all valid.
    const stored = await checks(id);
    expect(stored).toHaveLength(3 * 2 * round!.requirementIds.length);
    expect(stored.every((r) => r.valid)).toBe(true);

    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.gateVersion).toBe(3);
    expect(view.decision!.outcome).toBe("recommended");
    const matrix = view.decision!.matrix as { roundId: string; requirementGate: { proposals: Array<{ feasibility: string }> }; requirementsConflict: boolean };
    expect(matrix.roundId).toBe(round!.id);
    expect(matrix.requirementGate.proposals.every((p) => p.feasibility === "qualified")).toBe(true);
    expect(matrix.requirementsConflict).toBe(false);
    expect(view.decisionStatus).toMatchObject({ gateVersion: 3, approvable: true, canApproveRecommendation: true });
    // Version 1 checks on the vote are not written any more.
    const votes = await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id));
    expect(votes.every((v) => v.requirementChecks === null)).toBe(true);
    expect((await submitApproval(handle.db, actor, id, { action: "approve" })).status).toBe("approved");
  });

  it("the same model through two keys is one independent evaluator: 2× m1 + m2 is a limited review, never approvable (user decision 08.11.26)", async () => {
    const secondKey = (
      await createCredential(handle.db, actor, keyring, { provider: "anthropic", label: "second account", secret: "sk-ant-test-1111111111111111" })
    ).id;
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores } });
    const id = await start([
      { credentialId, modelId: "m1" },
      { credentialId: secondKey, modelId: "m1" },
      { credentialId, modelId: "m2" },
    ]);
    await runSession(c.deps, id);
    const [round] = await rounds(id);
    const view = await getSessionView(handle.db, actor, id);
    const [a1, a2] = view.participants.filter((p) => p.modelId === "m1").map((p) => p.id);
    // An instance of the author's model is never a foreign evaluator of that proposal.
    for (const p of round!.proposals)
      if (p.authorParticipantId === a1 || p.authorParticipantId === a2) expect(p.expectedEvaluatorIds).not.toContain(p.authorParticipantId === a1 ? a2 : a1);
    const gate = (view.decision!.matrix as { requirementGate: { proposals: Array<{ feasibility: string; limitedReview?: boolean }> } }).requirementGate;
    // Every proposal has one independent group at most: none is qualified, the verdict cannot be approved.
    expect(gate.proposals.some((p) => p.feasibility === "qualified")).toBe(false);
    expect(view.decisionStatus!.approvable).toBe(false);
    // The report names the instances as one independent voice.
    const { reportToMarkdown } = await import("../src");
    expect(reportToMarkdown(buildDecisionReport(view), "de")).toContain("anthropic/m1 (Instanz 2 von 2 – eine unabhängige Stimme)");
  });

  it("2× m1 + m2 + m3: two other models remain, so a proposal can still qualify (instances add no breadth, but take none away)", async () => {
    const secondKey = (
      await createCredential(handle.db, actor, keyring, { provider: "anthropic", label: "second account", secret: "sk-ant-test-1111111111111111" })
    ).id;
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } });
    const id = await start([{ credentialId, modelId: "m1" }, { credentialId: secondKey, modelId: "m1" }, ...c.participants.slice(1)]);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const gate = (view.decision!.matrix as { requirementGate: { proposals: Array<{ feasibility: string }> } }).requirementGate;
    expect(gate.proposals.some((p) => p.feasibility === "qualified")).toBe(true);
  });

  it("open requirement checks make the verdict needs_verification: nothing can be approved, no unsolvable claim", async () => {
    const r1Open: Script["requirementCheck"] = (_t, r) => (r === "R1" ? { status: "UNKNOWN" } : { status: "PASS" });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: r1Open },
      m2: { title: "Microservices", score: scores, requirementCheck: r1Open },
      m3: { title: "Serverless", score: scores, requirementCheck: r1Open },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(view.decisionStatus).toMatchObject({ approvable: false, canApproveRecommendation: false, approvableProposalIds: [] });
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: view.proposals[0]!.id, comment: "Anyway" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const report = buildDecisionReport(view);
    expect(JSON.stringify(report)).not.toMatch(/cannot be met together|No solution can meet these requirements/);
  });

  it("a PASS without the statement that every part is met never counts (owner rule 4)", async () => {
    const partial: Script["requirementCheck"] = () => ({ status: "PASS", allPartsMet: false });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: partial },
      m2: { title: "Microservices", score: scores, requirementCheck: partial },
      m3: { title: "Serverless", score: scores, requirementCheck: partial },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    expect((await getSessionView(handle.db, actor, id)).decision!.outcome).toBe("needs_verification");
  });

  it("stores checks for an unknown requirement id as invalid with the reason; they never count", async () => {
    // Every evaluator answers R1 under a wrong id: stored, marked invalid, and R1 stays open everywhere.
    const noR1: Script["requirementCheck"] = (_t, r) => (r === "R1" ? null : { status: "PASS" });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: noR1 },
      m2: { title: "Microservices", score: scores, requirementCheck: noR1 },
      m3: { title: "Serverless", score: scores, requirementCheck: noR1 },
    });
    for (const adapter of c.adapters.values()) {
      const original = adapter.generate.bind(adapter);
      adapter.generate = async (request) => {
        const result = await original(request);
        const json = result.json as { evaluations?: Array<{ requirementChecks?: unknown[] }> } | undefined;
        if (request.jsonSchema?.name === "evaluation" && Array.isArray(json?.evaluations))
          for (const e of json!.evaluations!) e.requirementChecks!.push({ requirementId: "R99", status: "PASS", allPartsMet: true, evidence: "about R1" });
        return result;
      };
    }
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const invalid = (await checks(id)).filter((r) => !r.valid);
    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid.every((r) => r.requirementId === "R99" && /not part of the confirmed list/.test(r.invalidReason!))).toBe(true);
    expect((await getSessionView(handle.db, actor, id)).decision!.outcome).toBe("needs_verification");
  });

  it("a dropout during the Final Verdict keeps E(p): no automatic recommendation, the round is reused on resume", async () => {
    const c = council({
      m1: { title: "Monolith", score: scores },
      m2: { title: "Microservices", score: scores, failsEvaluation: true },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const [round] = await rounds(id);
    // m2 delivered nothing, but stays an expected evaluator of the two other proposals.
    expect(round!.proposals.every((p) => p.expectedEvaluatorIds.length === 2)).toBe(true);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).not.toBe("recommended");
    expect(view.decisionStatus!.canApproveRecommendation).toBe(false);

    // The provider recovers: only the missing evaluation of the same frozen round is fetched; E(p) is unchanged.
    c.adapters.get("m2")!.script.failsEvaluation = false;
    const before = await checks(id);
    expect((await submitApproval(handle.db, actor, id, { action: "repeat_evaluation" })).status).toBe("queued");
    await runSession(c.deps, id);
    const after = await rounds(id);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(round);
    // Append-only: every earlier check is still there, unchanged.
    const now = await checks(id);
    for (const row of before) expect(now).toContainEqual(row);
    expect((await getSessionView(handle.db, actor, id)).decision!.outcome).toBe("recommended");
  });

  it("refuses more debate for a version-2 verdict before any change", async () => {
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const before = { votes: await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id)), checks: await checks(id) };
    const calls = requests(c);
    await expect(submitApproval(handle.db, actor, id, { action: "request_more_debate", comment: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/More debate is not available/),
    });
    expect(await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id))).toEqual(before.votes);
    expect(await checks(id)).toEqual(before.checks);
    expect(await handle.db.select().from(schema.humanApproval).where(eq(schema.humanApproval.sessionId, id))).toHaveLength(0);
    expect((await getSessionView(handle.db, actor, id)).session.status).toBe("awaiting_approval");
    expect(requests(c)).toBe(calls);
  });

  it("refuses repeat_evaluation when every expected evaluator delivered – a missing single check stays open", async () => {
    const noR2: Script["requirementCheck"] = (_t, r) => (r === "R2" ? null : { status: "PASS" });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: noR2 },
      m2: { title: "Microservices", score: scores, requirementCheck: noR2 },
      m3: { title: "Serverless", score: scores, requirementCheck: noR2 },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    expect((await getSessionView(handle.db, actor, id)).decision!.outcome).toBe("needs_verification");
    await expect(submitApproval(handle.db, actor, id, { action: "repeat_evaluation" })).rejects.toThrow(/No expected evaluator of this round is missing/);
  });

  it("no automatic recommendation when the winner's author alone blocks a higher-scored proposal (conflict of interest)", async () => {
    // m2 marks R1 of every other proposal UNKNOWN; its own lower-scored proposal would otherwise win.
    const c = council({
      m1: { title: "Monolith", score: scores },
      m2: { title: "Microservices", score: scores, requirementCheck: (_t, r) => (r === "R1" ? { status: "UNKNOWN" } : { status: "PASS" }) },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(view.decision!.recommendedProposalId).toBeNull();
    const matrix = view.decision!.matrix as { confidenceIssues: Array<{ kind: string }> };
    expect(matrix.confidenceIssues.map((i) => i.kind)).toContain("conflict_of_interest");
    expect(view.decisionStatus!.canApproveRecommendation).toBe(false);
  });

  it("a crash after freezing reuses the same round on resume", async () => {
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const [round] = await rounds(id);
    // Simulate a crash during the Final Verdict: stage and session back to running, the decision and one vote gone.
    await handle.db.delete(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    const [vote] = await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id));
    await handle.db.delete(schema.vote).where(eq(schema.vote.id, vote!.id));
    await handle.db
      .update(schema.workflowStage)
      .set({ status: "running" })
      .where(and(eq(schema.workflowStage.sessionId, id), eq(schema.workflowStage.phase, "final_verdict")));
    await handle.db.update(schema.councilSession).set({ status: "running" }).where(eq(schema.councilSession.id, id));
    // The model of the deleted vote dropped out meanwhile: it is not called again, and E(p) does not shrink.
    await handle.db.update(schema.councilParticipant).set({ status: "failed" }).where(eq(schema.councilParticipant.id, vote!.evaluatorParticipantId));
    await runSession(c.deps, id);
    expect(await rounds(id)).toEqual([round]);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.gateVersion).toBe(3);
    expect(view.decision!.outcome).not.toBe("recommended");
  });

  it("#181 core: an author's honest 'does not solve' is no veto when every evaluator confirmed every requirement", async () => {
    const c = council({
      m1: { title: "Monolith", score: scores, unsolvable: true },
      m2: { title: "Microservices", score: scores },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("recommended");
    expect(view.proposals.find((p) => p.id === view.decision!.recommendedProposalId)!.revisions.at(-1)!.content).toMatchObject({ title: "Monolith" });
  });

  it("#181 core: an author's false 'does not solve' never lets a competitor's sole objection decide the winner", async () => {
    // m1's Monolith scores highest but its author calls it insufficient; m2 alone marks R1 of the others UNKNOWN.
    const c = council({
      m1: { title: "Monolith", score: scores, unsolvable: true },
      m2: { title: "Microservices", score: scores, requirementCheck: (_t, r) => (r === "R1" ? { status: "UNKNOWN" } : { status: "PASS" }) },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(view.decision!.recommendedProposalId).toBeNull();
    const matrix = view.decision!.matrix as { confidenceIssues: Array<{ kind: string }> };
    expect(matrix.confidenceIssues.map((i) => i.kind)).toContain("conflict_of_interest");
  });

  // The coarse test engine does not implement this rule; it runs end-to-end when the engine is installed.
  it.skipIf(engine.info.kind !== "production")(
    "measured requirements (Council 1, 30.10.26): a model's 'not proven' on the go-live no longer blocks when every estimate keeps the limit",
    async () => {
      const { latestRequirementList } = await import("@consyrion/db");
      const list = (await latestRequirementList(handle.db, actor, projectId))!;
      const goLive = list.items.find((i) => /Go-live/.test(i.text))!;
      expect(goLive.measure).toEqual({ direction: "max", value: 4, unit: "months" });
      expect(list.items.find((i) => /300 EUR/.test(i.text))!.measure).toEqual({ direction: "max", value: 300, unit: "EUR/month" });

      // Like Claude in Council 1: "UNKNOWN – the schedule is not proven", but with an estimate of 3–4 months.
      const notProven =
        (range: { low: number; high: number }): Script["requirementCheck"] =>
        (_t, r) =>
          r === goLive.id ? { status: "UNKNOWN", estimate: range } : { status: "PASS" };
      const fits = council({
        m1: { title: "Monolith", score: scores, requirementCheck: notProven({ low: 3, high: 4 }) },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores },
      });
      const id = await start(fits.participants);
      await runSession(fits.deps, id);
      const prompt = fits.adapters.get("m2")!.requests.at(-1)!.messages[0]!.content;
      expect(prompt).toContain(`${goLive.id}: ${goLive.text} [estimate: at most 4 months – give estimateLow/estimateHigh in months]`);
      expect((await checks(id)).filter((r) => r.requirementId === goLive.id).every((r) => r.estimateLow !== null && r.estimateHigh !== null)).toBe(true);
      const view = await getSessionView(handle.db, actor, id);
      expect(view.decision!.outcome).toBe("recommended");

      // One range across the limit: not confirmed, and the cause says why in numbers.
      const straddles = council({
        m1: { title: "Monolith", score: scores, requirementCheck: notProven({ low: 3.5, high: 5 }) },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores },
      });
      const second = await start(straddles.participants);
      await runSession(straddles.deps, second);
      const verdict = await getSessionView(handle.db, actor, second);
      const gate = (verdict.decision!.matrix as { requirementGate: { proposals: Array<{ feasibility: string; causes: string[] }> } }).requirementGate;
      const blocked = gate.proposals.filter((p) => p.feasibility === "needs_verification");
      expect(blocked).toHaveLength(2);
      expect(blocked[0]!.causes[0]).toMatch(new RegExp(`^${goLive.id} not confirmed: estimates 3–5 months \\(median \\d`));
    },
  );

  it("test case 30.10.26: a reversed range (best case as low, worst as high) is stored in order", async () => {
    const { latestRequirementList } = await import("@consyrion/db");
    const list = (await latestRequirementList(handle.db, actor, projectId))!;
    const goLive = list.items.find((i) => /Go-live/.test(i.text))!;
    const reversed = council({
      m1: {
        title: "Monolith",
        score: scores,
        requirementCheck: (_t, r) => (r === goLive.id ? { status: "PASS", estimate: { low: 2, high: 1.5 } } : { status: "PASS" }),
      },
      m2: { title: "Microservices", score: scores },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(reversed.participants);
    await runSession(reversed.deps, id);
    const stored = (await checks(id)).filter((r) => r.requirementId === goLive.id && r.estimateLow !== null && r.estimateHigh !== null);
    expect(stored.some((r) => r.estimateLow === 1.5 && r.estimateHigh === 2)).toBe(true);
    expect(stored.every((r) => r.estimateLow! <= r.estimateHigh!)).toBe(true);
  });

  it.skipIf(engine.info.kind !== "production")("an evaluator that leaves the checks of one proposal out gives no automatic recommendation", async () => {
    // m3 delivers its evaluation but says nothing about the Monolith's requirements.
    const c = council({
      m1: { title: "Monolith", score: scores },
      m2: { title: "Microservices", score: scores },
      m3: { title: "Serverless", score: scores, requirementCheck: (t) => (t === "Monolith" ? null : { status: "PASS" }) },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(view.decision!.recommendedProposalId).toBeNull();
  });

  // #228: the repair of a cut-off Final Verdict is itself cut off (the first GPT-1 run, 30.10.26). There is no third
  // attempt, and nothing replaces the lost checks: the two proposals that evaluator had to check stay unconfirmed.
  it.skipIf(engine.info.kind !== "production")(
    "#228: a Final Verdict cut off twice loses that evaluator – fail-closed, named, never a recommendation",
    async () => {
      const c = council({
        m1: { title: "Monolith", score: scores, silentlyTruncatedEvaluations: 2 },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores },
      });
      const id = await start(c.participants);
      await runSession(c.deps, id);
      expect(c.adapters.get("m1")!.requests.filter((r) => r.jsonSchema!.name === "evaluation")).toHaveLength(2);
      const view = await getSessionView(handle.db, actor, id);
      expect(view.decision!.outcome).toBe("needs_verification");
      expect(view.decision!.recommendedProposalId).toBeNull();
      const matrix = view.decision!.matrix as {
        failedEvaluators: Array<{ participantId: string }>;
        requirementGate: { proposals: Array<{ proposalId: string; feasibility: string }> };
      };
      const m1 = view.participants.find((p) => p.modelId === "m1")!;
      expect(matrix.failedEvaluators.map((f) => f.participantId)).toEqual([m1.id]);
      // Its own proposal is checked by the two others and can still qualify; the two it had to check cannot.
      const own = view.proposals.find((p) => p.authorParticipantId === m1.id)!;
      const byId = new Map(matrix.requirementGate.proposals.map((p) => [p.proposalId, p.feasibility]));
      expect(byId.get(own.id)).toBe("qualified");
      expect(view.proposals.filter((p) => p.id !== own.id).every((p) => byId.get(p.id) === "needs_verification")).toBe(true);
      // No vote and no raw checks of the lost evaluator are stored from the broken text.
      expect((await checks(id)).some((r) => r.evaluatorParticipantId === m1.id)).toBe(false);
    },
  );

  describe("#246: a Final Verdict too large for one call is split into requirement groups", () => {
    async function manyRequirements() {
      await updateBrief(handle.db, actor, projectId, {
        idea: "Design a scheduling SaaS for 120 clinics.",
        requirements: Array.from({ length: 13 }, (_, i) => `Requirement number ${i + 1} must be met.`).join("\n"),
      });
      // The three requirements confirmed in beforeEach stay on the list (a later proposal keeps earlier decisions).
      const count = (await confirmProposedRequirements(handle.db, actor, projectId)).items.length;
      expect(count).toBeGreaterThan(12);
      return count;
    }
    const gateOf = async (id: string) =>
      (
        (await getSessionView(handle.db, actor, id)).decision!.matrix as {
          requirementGate: { proposals: Array<{ feasibility: string; requirements: Array<{ requirementId: string; status: string }> }> };
        }
      ).requirementGate.proposals.map((p) => ({
        feasibility: p.feasibility,
        requirements: [...p.requirements].sort((a, b) => a.requirementId.localeCompare(b.requirementId)).map((r) => `${r.requirementId}:${r.status}`),
      }));
    const r2Fails: Script["requirementCheck"] = (t, r) => (t === "Serverless" && r === "R2" ? { status: "FAIL" } : { status: "PASS" });

    it("starts instead of refusing; every evaluator checks each requirement in exactly one call and the verdict stands", async () => {
      const count = await manyRequirements();
      const c = council({
        m1: { title: "Monolith", score: scores, requirementCheck: r2Fails },
        m2: { title: "Microservices", score: scores, requirementCheck: r2Fails },
        m3: { title: "Serverless", score: scores, requirementCheck: r2Fails },
      });
      const id = await start(c.participants);
      await runSession(c.deps, id);
      // 2 calls per evaluator: the first scores and checks group 1, the second only checks group 2.
      for (const adapter of c.adapters.values()) {
        expect(adapter.evaluationScopes).toHaveLength(2);
        const scoped = adapter.evaluationScopes.map((s) => s!.split(",").map((x) => x.trim()));
        expect(scoped.flat().sort()).toEqual([...new Set(scoped.flat())].sort());
        expect(scoped.flat()).toHaveLength(count);
      }
      const stored = await checks(id);
      expect(stored.filter((r) => r.valid)).toHaveLength(3 * 2 * count);
      expect(stored.every((r) => r.valid)).toBe(true);
      const votes = await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id));
      expect(votes).toHaveLength(3);
      const view = await getSessionView(handle.db, actor, id);
      expect(view.decision!.outcome).toBe("recommended");
      const gate = await gateOf(id);
      expect(gate.filter((p) => p.feasibility === "fail")).toHaveLength(1);
      expect(view.session.tokensUsed).toBeLessThanOrEqual(view.session.tokenBudget);
    });

    it("same answers, same gate: a model that ignores the scope and checks everything twice changes nothing", async () => {
      await manyRequirements();
      const obedient = council({
        m1: { title: "Monolith", score: scores, requirementCheck: r2Fails },
        m2: { title: "Microservices", score: scores, requirementCheck: r2Fails },
        m3: { title: "Serverless", score: scores, requirementCheck: r2Fails },
      });
      const a = await start(obedient.participants);
      await runSession(obedient.deps, a);
      const noisy = council({
        m1: { title: "Monolith", score: scores, requirementCheck: r2Fails, ignoresRequirementScope: true },
        m2: { title: "Microservices", score: scores, requirementCheck: r2Fails, ignoresRequirementScope: true },
        m3: { title: "Serverless", score: scores, requirementCheck: r2Fails, ignoresRequirementScope: true },
      });
      const b = await start(noisy.participants);
      await runSession(noisy.deps, b);
      // The extra checks are stored (append-only) but as invalid with their reason; every requirement counts once.
      const extra = (await checks(b)).filter((r) => !r.valid);
      expect(extra.length).toBeGreaterThan(0);
      expect(extra.every((r) => r.invalidReason === "requirement id belongs to another call of this split evaluation")).toBe(true);
      expect((await checks(b)).filter((r) => r.valid)).toHaveLength((await checks(a)).filter((r) => r.valid).length);
      expect(await gateOf(b)).toEqual(await gateOf(a));
      expect((await getSessionView(handle.db, actor, b)).decision!.outcome).toBe((await getSessionView(handle.db, actor, a)).decision!.outcome);
    });

    it("the preview names the split and counts the extra calls", async () => {
      const count = await manyRequirements();
      const c = council({ m1: { title: "Monolith" }, m2: { title: "Microservices" }, m3: { title: "Serverless" } });
      const preview = await previewSession(handle.db, actor, projectId, { mode: "independent_expert", participants: c.participants, confirmBudget: true });
      expect(preview.finalVerdictSize).toMatchObject({ fits: true, split: true, callsPerEvaluator: 2 });
      expect(preview.finalVerdictSize.message).toMatch(new RegExp(`^3 models × ${count} requirements .* in 2 calls`));
    });
  });

  it("a tight budget shortens the debate but never an S1 evaluation: the reserve covers every requirement check", async () => {
    // Six confirmed requirements: each Final Verdict call needs 2 proposals × 6 checks of output room, more than a
    // plain scorecard. The reserve kept for it must be sized the same way, or an evaluator is refused for budget.
    await updateBrief(handle.db, actor, projectId, {
      idea: "Design a scheduling SaaS for 120 clinics.",
      requirements:
        "Health data must stay in Germany. Running costs must not exceed 300 EUR per month. Go-live within 4 months. Backups must be encrypted. Every access must be logged. The system must be available 99.5% of the time.",
    });
    expect((await confirmProposedRequirements(handle.db, actor, projectId)).items).toHaveLength(6);
    const c = council({
      m1: { title: "Monolith", score: scores, usage: 3_500 },
      m2: { title: "Microservices", score: scores, usage: 3_500 },
      m3: { title: "Serverless", score: scores, usage: 3_500 },
    });
    const budget = TIGHT_S1_BUDGET;
    const { id } = await createSession(handle.db, actor, projectId, {
      mode: "independent_expert",
      participants: c.participants,
      confirmBudget: true,
      tokenBudget: budget,
    });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.stages.some((s) => s.status === "skipped" && /kept for the Final Verdict/.test(s.error ?? ""))).toBe(true);
    expect(view.stages.find((s) => s.phase === "final_verdict")!.status).toBe("completed");
    const votes = await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id));
    expect(new Set(votes.map((v) => v.evaluatorParticipantId)).size).toBe(3);
    expect((await checks(id)).filter((r) => r.valid)).toHaveLength(3 * 2 * 6);
    expect(view.decision!.outcome).toBe("recommended");
    expect(view.session.tokensUsed).toBeLessThanOrEqual(budget);
  });

  it("refuses approval and build of a verdict whose matrix does not match its frozen round (#181 review A)", async () => {
    const c = council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    const matrix = decision!.matrix as Record<string, unknown>;
    const change = (m: Record<string, unknown>) => handle.db.update(schema.finalDecision).set({ matrix: m }).where(eq(schema.finalDecision.id, decision!.id));
    await change({ ...matrix, roundId: "rnd_other" });
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toThrow(/does not match its evaluation round/);
    await change({ ...matrix, requirementIds: (matrix.requirementIds as string[]).slice(1) });
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    await change(matrix);
    expect((await submitApproval(handle.db, actor, id, { action: "approve" })).status).toBe("approved");
  });

  it("rejects an inconsistent engine result instead of storing it (#181 review, fail closed)", () => {
    const round = {
      requirementIds: ["R1", "R2"],
      proposals: [{ proposalId: "A", revisionId: "A1", authorParticipantId: "e1", expectedEvaluatorIds: ["e2"] }],
    };
    const req = (requirementId: string, status = "PASS") => ({ requirementId, status, pass: ["e2"], fail: [], unknown: [], open: [], conflicts: [] });
    const ok = {
      proposals: [{ proposalId: "A", feasibility: "qualified", requirements: [req("R1"), req("R2")], causes: [], soleBlocker: null }],
      comparisonComplete: true,
      comparisonNote: null,
      summary: null,
    };
    expect(() => assertGateResultConsistent(round, ok as never)).not.toThrow();
    const broken = [
      { ...ok, proposals: [] },
      { ...ok, proposals: [...ok.proposals, ...ok.proposals] },
      { ...ok, proposals: [{ ...ok.proposals[0]!, requirements: [req("R1")] }] },
      { ...ok, proposals: [{ ...ok.proposals[0]!, requirements: [req("R1"), req("R2", "UNKNOWN")] }] },
      { ...ok, proposals: [{ ...ok.proposals[0]!, feasibility: "maybe" }] },
      { ...ok, proposals: [{ ...ok.proposals[0]!, soleBlocker: "e9" }] },
      { ...ok, comparisonComplete: "yes" },
    ];
    for (const result of broken) expect(() => assertGateResultConsistent(round, result as never)).toThrow(/inconsistent requirement gate result/);
  });
});

describe("#228/#229 follow-up round – same evaluators, append-only, a FAIL is never replaced", () => {
  it.skipIf(engine.info.kind !== "production")(
    "completes the checks an evaluator left out, after a click with extra budget, and recomputes the verdict",
    async () => {
      // m3 leaves out the Monolith's checks in its evaluation and answers them when asked again.
      let asked = 0;
      const c = council({
        m1: { title: "Monolith", score: scores },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores, requirementCheck: (t) => (t === "Monolith" && asked === 0 ? null : { status: "PASS" }) },
      });
      const id = await start(c.participants);
      await runSession(c.deps, id);
      expect((await getSessionView(handle.db, actor, id)).decision!.outcome).toBe("needs_verification");
      const preview = await previewFollowUp(handle.db, actor, id);
      expect(preview).toMatchObject({ enabled: true, available: true });
      expect(preview.completion.items).toBeGreaterThan(0);
      expect(preview.completion.estimatedTokens).toBeGreaterThan(0);
      // Without confirmation or below the estimate nothing starts.
      await expect(
        startFollowUp(handle.db, actor, id, { kind: "completion", tokenBudget: preview.completion.estimatedTokens, confirmBudget: false }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(startFollowUp(handle.db, actor, id, { kind: "completion", tokenBudget: 10, confirmBudget: true })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      const before = (await getSessionView(handle.db, actor, id)).session.tokenBudget;
      const started = await startFollowUp(handle.db, actor, id, {
        kind: "completion",
        tokenBudget: preview.completion.estimatedTokens * 2,
        confirmBudget: true,
      });
      expect(started).toMatchObject({ kind: "completion", round: 2 });
      asked = 1;
      const requestsBefore = c.adapters.get("m3")!.requests.length;
      await runSession(c.deps, id);
      // Only m3 was asked – exactly once, about the Monolith only.
      expect(c.adapters.get("m3")!.requests.length).toBe(requestsBefore + 1);
      expect(c.adapters.get("m1")!.requests.at(-1)!.jsonSchema!.name).not.toBe("evaluation_checks");
      const view = await getSessionView(handle.db, actor, id);
      expect(view.session.tokenBudget).toBe(before + preview.completion.estimatedTokens * 2);
      expect(view.decision!.outcome).not.toBe("needs_verification");
      expect((view.decision!.matrix as { followUpRounds?: unknown[] }).followUpRounds).toEqual([
        { round: 2, kind: "completion", items: preview.completion.items, applied: true },
      ]);
      // Round 1 stays as it was: the follow-up's checks are stored under their own round.
      const all = await rounds(id);
      const first = all.find((r) => r.round === 1)!;
      const second = all.find((r) => r.round === 2)!;
      expect(second).toMatchObject({ kind: "completion", parentRoundId: first.id, status: "done" });
      expect((await checks(id)).filter((r) => r.roundId === second.id && r.valid).length).toBeGreaterThan(0);
    },
  );

  it.skipIf(engine.info.kind !== "production")("re-checks only the evaluator's own UNKNOWN items and never asks about a FAIL", async () => {
    let second = false;
    const r1: Script["requirementCheck"] = (_t, r) => (r === "R1" ? { status: second ? "PASS" : "UNKNOWN" } : { status: "PASS" });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: r1 },
      m2: { title: "Microservices", score: scores, requirementCheck: (_t, r) => (r === "R2" ? { status: "FAIL" } : { status: "PASS" }) },
      m3: { title: "Serverless", score: scores },
    });
    const id = await start(c.participants);
    await runSession(c.deps, id);
    const preview = await previewFollowUp(handle.db, actor, id);
    expect(preview.targetedReview.items).toBeGreaterThan(0);
    await startFollowUp(handle.db, actor, id, { kind: "targeted_review", tokenBudget: preview.targetedReview.estimatedTokens, confirmBudget: true });
    second = true;
    await runSession(c.deps, id);
    // Only m1 had UNKNOWN items – m2's FAIL is never asked again.
    const followUpRequests = [...c.adapters.entries()].filter(([, a]) =>
      a.requests.some((r) => r.system?.includes("Follow-up check") || String(r.messages[0]?.content ?? "").includes("Follow-up check")),
    );
    expect(followUpRequests.map(([m]) => m)).toEqual(["m1"]);
    const view = await getSessionView(handle.db, actor, id);
    const gate = (view.decision!.matrix as { requirementGate: { proposals: Array<{ requirements: Array<{ requirementId: string; status: string }> }> } })
      .requirementGate;
    // The FAIL on R2 is still there after the follow-up.
    expect(gate.proposals.some((p) => p.requirements.some((r) => r.requirementId === "R2" && r.status === "FAIL"))).toBe(true);
    // A second follow-up of the same kind finds nothing open any more for m1's R1.
    expect((await previewFollowUp(handle.db, actor, id)).targetedReview.items).toBeLessThan(preview.targetedReview.items);
  });
});
