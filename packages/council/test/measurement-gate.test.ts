/**
 * #249 part 2 (gate version 3, engine contract 5): a requirement only measuring the running implementation can prove
 * (OnJam R5 "rhythmisch stabiles Zusammenspiel") is checked as a measurement plan. A proposal whose every check passed
 * is an architecture candidate – never qualified, never recommended, never approvable as a finished solution. Councils
 * started for gate version 2 keep their old result.
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  setSubscriptionPlan,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDecisionReport, createSession, getSessionView, recordMeasurement, runSession, submitApproval, type SessionInput } from "../src";
import { ARCHITECTURE_CANDIDATE_MESSAGE, GATE_VERSION } from "../src/decision-format";
import { REFERENCE_CASES } from "../eval/reference-cases";
import { classifyReport, scoreRun } from "../eval/reference-score";
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
      name: "OnJam latency",
      type: "architecture",
      brief: {
        idea: "Design the audio transport for online jam sessions.",
        requirements: "Die Lösung muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen. Running costs must not exceed 300 EUR per month.",
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

const scores = (t: string) => (t === "Monolith" ? 9 : 6);
const three = () =>
  council({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } });

async function start(c: ReturnType<typeof council>, gateVersion?: number) {
  const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants: c.participants, confirmBudget: true });
  // A council started by the previous release (gate version 2) and finished by this one.
  if (gateVersion !== undefined) await handle.db.update(schema.councilSession).set({ gateVersion }).where(eq(schema.councilSession.id, id));
  return id;
}

type Gate = {
  proposals: Array<{
    feasibility: string;
    architectureCandidate?: boolean;
    requirements: Array<{ requirementId: string; status: string; measurementPending?: boolean }>;
  }>;
  summary: string | null;
};

describe("measurement checks (#249 part 2, gate version 3)", () => {
  it("the confirmed list marks the requirement; new councils start for gate version 3", async () => {
    const [list] = await handle.db.select().from(schema.requirementList).where(eq(schema.requirementList.projectId, projectId));
    const rhythm = list!.items.find((i) => /rhythmisch/.test(i.text))!;
    expect(rhythm.verification).toBe("measurement");
    // The requirement text stays exactly as written – a measurement plan never replaces it.
    expect(rhythm.text).toMatch(/rhythmisch stabiles Zusammenspiel/);
    expect(GATE_VERSION).toBe(3);
    const id = await start(three());
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    expect(session!.gateVersion).toBe(3);
  });

  it("every check passed: an architecture candidate – not recommended, not approvable, marked in report and view", async () => {
    const c = three();
    const id = await start(c);
    await runSession(c.deps, id);

    // The evaluators were told that PASS means a concrete measurement plan, never that the requirement is met.
    const finalVerdictPrompts = [...c.adapters.values()].flatMap((a) => a.requests.map((r) => r.messages.map((m) => m.content).join("\n")));
    expect(finalVerdictPrompts.some((p) => /\[measurement check: only measuring the running implementation can prove this/.test(p))).toBe(true);

    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.gateVersion).toBe(3);
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(view.decision!.recommendedProposalId).toBeNull();
    const gate = (view.decision!.matrix as { requirementGate: Gate }).requirementGate;
    expect(gate.proposals.every((p) => p.feasibility === "needs_verification" && p.architectureCandidate === true)).toBe(true);
    const rhythmId = view.requirementList!.items.find((i) => /rhythmisch/.test(i.text))!.id;
    for (const p of gate.proposals)
      expect(p.requirements.find((r) => r.requirementId === rhythmId)).toMatchObject({ status: "PASS", measurementPending: true });
    expect(gate.summary).toMatch(/architecture candidates? with the performance proof open, not a recommendation/);
    expect(view.decisionStatus).toMatchObject({ gateVersion: 3, approvable: false, canApproveRecommendation: false });
    expect(view.decisionStatus!.approvableProposalIds ?? []).toEqual([]);

    const other = view.proposals[0]!;
    await expect(
      submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: other.id, comment: "Build it" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const report = buildDecisionReport(view);
    expect(report.requirementGate!.proposals.every((p) => p.feasibility === "architecture candidate (performance proof open)")).toBe(true);
    expect(report.confirmedRequirements!.items.find((i) => i.id === rhythmId)).toMatchObject({ measurementCheck: true });
    expect(report.requirementMatrix!.proposals[0]!.cells.some((cell) => cell.status === "MEASUREMENT_PLAN")).toBe(true);
  });

  it("no measurement plan stays not confirmed – no candidate mark", async () => {
    const noPlan: Script["requirementCheck"] = (_t, r) => (r === "R1" ? { status: "UNKNOWN" } : { status: "PASS" });
    const c = council({
      m1: { title: "Monolith", score: scores, requirementCheck: noPlan },
      m2: { title: "Microservices", score: scores, requirementCheck: noPlan },
      m3: { title: "Serverless", score: scores, requirementCheck: noPlan },
    });
    const id = await start(c);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const gate = (view.decision!.matrix as { requirementGate: Gate }).requirementGate;
    expect(view.decision!.outcome).toBe("needs_verification");
    expect(gate.proposals.some((p) => p.architectureCandidate === true)).toBe(false);
  });

  it("regression: a council started for gate version 2 keeps the old rules and result", async () => {
    const c = three();
    const id = await start(c, 2);
    await runSession(c.deps, id);
    const prompts = [...c.adapters.values()].flatMap((a) => a.requests.map((r) => r.messages.map((m) => m.content).join("\n")));
    expect(prompts.some((p) => p.includes("[measurement check"))).toBe(false);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.gateVersion).toBe(2);
    expect(view.decision!.outcome).toBe("recommended");
    const gate = (view.decision!.matrix as { requirementGate: Gate }).requirementGate;
    expect(gate.proposals.every((p) => p.feasibility === "qualified" && p.architectureCandidate === undefined)).toBe(true);
    expect(view.decisionStatus).toMatchObject({ gateVersion: 2, approvable: true });
  });

  it("the approval check refuses a stored architecture candidate with its own message", async () => {
    const c = three();
    const id = await start(c);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    // Even a tampered outcome cannot make the candidate approvable: the gate entry decides.
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, id));
    const matrix = decision!.matrix as { outcome?: string; recommendedProposalId?: string | null };
    const proposalId = view.proposals[0]!.id;
    await handle.db
      .update(schema.finalDecision)
      .set({
        outcome: "recommended",
        recommendedProposalId: proposalId,
        matrix: { ...matrix, outcome: "recommended", recommendedProposalId: proposalId } as never,
      })
      .where(eq(schema.finalDecision.id, decision!.id));
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: ARCHITECTURE_CANDIDATE_MESSAGE,
    });
  });
});

describe("pos-latency-limit offline regression (owner decision 08.11.26, variant A)", () => {
  // Benchmark 09.11.26: the only unnecessary block of the minimal benchmark. With gate version 3 a latency limit is a
  // measurement check: an architecture candidate, never a recommendation and never a plain block.
  async function latencyProject() {
    const id = (
      await createProject(handle.db, actor, {
        name: "Sales dashboard",
        type: "architecture",
        brief: {
          idea: "Internal dashboard showing order numbers for 50 sales staff.",
          goal: "Sales staff see today's orders without asking finance.",
          requirements: "95 % of page loads must complete within 300 ms inside the company network. Only sales staff may log in.",
        },
      })
    ).id;
    await confirmProposedRequirements(handle.db, actor, id);
    return id;
  }

  it("gate version 3: every evaluator confirms the plan – an architecture candidate, classified as such", async () => {
    const latency = await latencyProject();
    const [list] = await handle.db.select().from(schema.requirementList).where(eq(schema.requirementList.projectId, latency));
    expect(list!.items.find((i) => /300 ms/.test(i.text))!.verification).toBe("measurement");
    const c = three();
    const { id } = await createSession(handle.db, actor, latency, { mode: "independent_expert", participants: c.participants, confirmBudget: true });
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("needs_verification");
    const report = buildDecisionReport(view);
    expect(classifyReport(report)).toBe("architecture_candidate");
    expect(scoreRun(REFERENCE_CASES.find((r) => r.id === "pos-latency-limit")!, report).result).toBe("correct");
  });

  it("gate version 2 keeps the old result for the same brief", async () => {
    const latency = await latencyProject();
    const c = three();
    const { id } = await createSession(handle.db, actor, latency, { mode: "independent_expert", participants: c.participants, confirmBudget: true });
    await handle.db.update(schema.councilSession).set({ gateVersion: 2 }).where(eq(schema.councilSession.id, id));
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decision!.outcome).toBe("recommended");
  });
});

describe("#249 part 2: favourite, prototype build and approval after measurement (variant B, gate 2)", () => {
  async function candidateSession() {
    const c = three();
    const id = await start(c);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    const rhythmId = view.requirementList!.items.find((i) => /rhythmisch/.test(i.text))!.id;
    return { id, view, rhythmId, proposalId: view.proposals[0]!.id };
  }
  const measure = (proposalId: string, requirementId: string, met: boolean) => ({
    proposalId,
    requirementId,
    method: "Loopback test with 4 musicians, 20 sessions",
    target: "≤ 25 ms jitter at p95",
    measured: met ? "18 ms" : "41 ms",
    met,
    evidence: "Measurement log 2026-11-10, attached to the ticket",
  });

  it("an architecture candidate may be marked or get a prototype build – never approved, the session keeps waiting", async () => {
    const { id, view, proposalId } = await candidateSession();
    expect(view.decisionStatus!.prototypeProposalIds).toEqual(expect.arrayContaining(view.proposals.map((p) => p.id)));
    expect(view.decisionStatus!.measurementApprovableProposalIds).toEqual([]);
    await expect(submitApproval(handle.db, actor, id, { action: "mark_favorite", selectedProposalId: proposalId })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await submitApproval(handle.db, actor, id, { action: "mark_favorite", selectedProposalId: proposalId, comment: "Best latency design" })).toEqual({
      status: "awaiting_approval",
    });
    expect((await getSessionView(handle.db, actor, id)).humanMark).toMatchObject({ kind: "favorite", proposalId });
    await submitApproval(handle.db, actor, id, { action: "approve_prototype", selectedProposalId: proposalId, comment: "Measure jitter with 4 musicians" });
    const after = await getSessionView(handle.db, actor, id);
    expect(after.session.status).toBe("awaiting_approval");
    expect(after.humanMark).toMatchObject({ kind: "prototype_build", proposalId });
    // The regular approval paths stay closed.
    await expect(submitApproval(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitApproval(handle.db, actor, id, { action: "select_alternative", selectedProposalId: proposalId, comment: "x" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(submitApproval(handle.db, actor, id, { action: "approve_after_measurement", selectedProposalId: proposalId })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/Measurement still open/),
    });
  });

  it("gate 2: once every open measurement is recorded as met, the candidate is approved after measurement", async () => {
    const { id, proposalId, rhythmId } = await candidateSession();
    // Only requirements whose measurement is open can be recorded.
    const other = (await getSessionView(handle.db, actor, id)).requirementList!.items.find((i) => i.id !== rhythmId)!.id;
    await expect(recordMeasurement(handle.db, actor, id, measure(proposalId, other, true))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(recordMeasurement(handle.db, actor, id, { ...measure(proposalId, rhythmId, true), evidence: "" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await recordMeasurement(handle.db, actor, id, measure(proposalId, rhythmId, true));
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decisionStatus!.measurementApprovableProposalIds).toEqual([proposalId]);
    expect(view.measurements).toEqual([
      expect.objectContaining({ requirementId: rhythmId, met: true, recordedBy: "Owner", evidence: expect.stringMatching(/Measurement log/) }),
    ]);
    expect(await submitApproval(handle.db, actor, id, { action: "approve_after_measurement", selectedProposalId: proposalId })).toEqual({ status: "approved" });
    const audit = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.targetId, id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["council.measurement_recorded", "council.approve_after_measurement"]));
    expect(audit.find((a) => a.action === "council.measurement_recorded")!.metadata).toMatchObject({ selfDeclared: true, met: true });
  });

  it("a measured miss blocks the proposal for good – a later 'met' does not undo it", async () => {
    const { id, proposalId, rhythmId } = await candidateSession();
    await recordMeasurement(handle.db, actor, id, measure(proposalId, rhythmId, false));
    await expect(recordMeasurement(handle.db, actor, id, measure(proposalId, rhythmId, true))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitApproval(handle.db, actor, id, { action: "approve_after_measurement", selectedProposalId: proposalId })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/did not meet/),
    });
    expect((await getSessionView(handle.db, actor, id)).decisionStatus!.measurementApprovableProposalIds).toEqual([]);
  });

  it("gate version 2 councils get none of it", async () => {
    const c = three();
    const id = await start(c, 2);
    await runSession(c.deps, id);
    const view = await getSessionView(handle.db, actor, id);
    expect(view.decisionStatus!.prototypeProposalIds).toEqual([]);
    await expect(
      submitApproval(handle.db, actor, id, { action: "mark_favorite", selectedProposalId: view.proposals[0]!.id, comment: "x" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
