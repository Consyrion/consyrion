import { randomBytes } from "node:crypto";
import { keyringFromEnv, MAX_TASK_ATTEMPTS } from "@consyrion/core";
import { createSession, runSession, submitApproval } from "@consyrion/council";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
  setSubscriptionPlan,
  updateBrief,
} from "@consyrion/db";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelExecution,
  decidePlan,
  exportPatch,
  getExecutionView,
  resumeExecution,
  runExecution,
  startExecution,
  type Sandbox,
  type SandboxResult,
} from "../src";
// Reuse the council's scripted models for the decision; add scripted engineering answers here.
import { ScriptedAdapter } from "../../council/test/scripted-adapter";
import { ScriptedEngineer } from "./scripted-engineer";
import { confirmProposedRequirements } from "../../council/test/confirm-requirements";

let handle: DatabaseHandle;
let actor: ActorContext;
let projectId: string;
let credentialId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

/** TEST DOUBLE sandbox: records commands; tests fail until the repair has been applied. */
class FakeSandbox implements Sandbox {
  readonly name = "fake";
  readonly runs: Array<{ command: string; network: string; files: string[] }> = [];
  constructor(private readonly behaviour: (n: number) => SandboxResult["status"]) {}
  async available() {
    return true;
  }
  async run(request: { command: string; network: "none" | "egress"; workspaceDir: string }): Promise<SandboxResult> {
    const { readdir } = await import("node:fs/promises");
    this.runs.push({ command: request.command, network: request.network, files: (await readdir(request.workspaceDir, { recursive: true })) as string[] });
    const testRuns = this.runs.filter((r) => r.command === "npm test").length;
    const status = request.command === "npm test" ? this.behaviour(testRuns) : "passed";
    return { status, exitCode: status === "passed" ? 0 : 1, output: status === "passed" ? "ok" : "AssertionError: sum(1,2) expected 3", durationMs: 5 };
  }
}

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  // Plan limits are tested separately; these tests use the largest plan.
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  projectId = (
    await createProject(handle.db, actor, { name: "Calc", type: "idea", brief: { idea: "Build a tiny calculator library with tests and a sum function." } })
  ).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, actor, projectId);
});

afterEach(async () => {
  await handle.close();
});

async function approvedSession(
  engineerOptions: ConstructorParameters<typeof ScriptedEngineer>[1] = {},
  m2Options = engineerOptions,
  /** A council started before the S1 release (#181): gate version 1, finished with the production gate. */
  legacyGate = false,
) {
  const adapters = {
    m1: new ScriptedEngineer(new ScriptedAdapter({ title: "Library", score: (t) => (t === "Library" ? 9 : 6) }), engineerOptions),
    m2: new ScriptedEngineer(new ScriptedAdapter({ title: "Service", score: (t) => (t === "Library" ? 9 : 6) }), m2Options),
    // A third model: with fewer than two independent evaluators per proposal the engine never recommends (#249).
    m3: new ScriptedEngineer(new ScriptedAdapter({ title: "Monolith", score: (t) => (t === "Library" ? 9 : 6) }), m2Options),
  };
  const resolveAdapter = async (p: { modelId: string }) => adapters[p.modelId as keyof typeof adapters];
  const { id } = await createSession(handle.db, actor, projectId, {
    mode: "independent_expert",
    tokenBudget: 1_000_000,
    participants: [
      { credentialId, modelId: "m1" },
      { credentialId, modelId: "m2" },
      { credentialId, modelId: "m3" },
    ],
  });
  if (legacyGate) await handle.db.update(schema.councilSession).set({ gateVersion: 1 }).where(eq(schema.councilSession.id, id));
  await runSession({ db: handle.db, resolveAdapter, random: () => 0.5 }, id);
  return { sessionId: id, resolveAdapter, adapters };
}

describe("Execution Council", () => {
  it("cannot start without an approved decision", async () => {
    const { sessionId } = await approvedSession();
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to build an approved proposal that the verdict marks as not implementable (#121)", async () => {
    const { sessionId } = await approvedSession({}, {}, true);
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    // An approval recorded before the feasibility gate existed, against a verdict that now marks it a finding.
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, sessionId));
    const matrix = decision!.matrix as { proposals: Array<Record<string, unknown>> };
    await handle.db
      .update(schema.finalDecision)
      .set({ matrix: { ...matrix, proposals: matrix.proposals.map((p) => ({ ...p, implementable: false })) } })
      .where(eq(schema.finalDecision.id, decision!.id));
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/not an implementable solution/),
    });
  });

  it("builds a legacy gate-version-1 decision, refuses unknown versions, missing entries and contradictions (#181, stage 1)", async () => {
    const { sessionId } = await approvedSession({}, {}, true);
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, sessionId));
    expect(decision!.gateVersion).toBe(1);
    const matrix = decision!.matrix as { proposals: Array<Record<string, unknown>> };
    const change = (values: Partial<typeof schema.finalDecision.$inferInsert>) =>
      handle.db.update(schema.finalDecision).set(values).where(eq(schema.finalDecision.id, decision!.id));
    const refused = (message: RegExp) =>
      expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringMatching(message),
      });

    await change({ gateVersion: 4 });
    await refused(/gate version 4/);
    await change({ gateVersion: null });
    await refused(/no format version/);
    await change({ gateVersion: 1, matrix: { ...matrix, proposals: [] } });
    await refused(/not part of the stored verdict/);
    await change({ matrix: { ...matrix, outcome: "tie" } });
    await refused(/contradicts itself/);
    await change({ matrix, outcome: "needs_verification" });
    await refused(/Needs verification/);
    // Legacy version 1, consistent: today's behaviour.
    await change({ matrix, outcome: "recommended" });
    expect((await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).id).toBeTruthy();
  });

  it("refuses an approval of another requirement list version (#190)", async () => {
    const { sessionId } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId));
    const [approval] = await handle.db.select().from(schema.humanApproval).where(eq(schema.humanApproval.sessionId, sessionId));
    expect(session!.requirementListId).toBeTruthy();
    expect(approval!.requirementListId).toBe(session!.requirementListId);
    // A newer list version of the same project (the brief changed and was confirmed again).
    await updateBrief(handle.db, actor, projectId, {
      idea: "Build a tiny calculator library with tests, a sum and a product function.",
      requirements: "Only integer input.",
    });
    const v2 = await confirmProposedRequirements(handle.db, actor, projectId);
    expect(v2.id).not.toBe(session!.requirementListId);
    // An approval that names V2 cannot build the V1 verdict of this session.
    await handle.db.update(schema.humanApproval).set({ requirementListId: v2.id }).where(eq(schema.humanApproval.id, approval!.id));
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/different requirement list version/),
    });
    // Back to its own list: the historic V1 approval still builds its own V1 state.
    await handle.db.update(schema.humanApproval).set({ requirementListId: session!.requirementListId }).where(eq(schema.humanApproval.id, approval!.id));
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("re-checks the approval whenever a build job runs: a rolled-back release never continues a newer run (#181, stage 1b)", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    const before = adapters.m1.requests.length + adapters.m2.requests.length;
    // The queued build belongs to a council a newer release started for gate version 4.
    await handle.db.update(schema.councilSession).set({ gateVersion: 4 }).where(eq(schema.councilSession.id, sessionId));
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("failed");
    expect(view.plan.error).toMatch(/gate version 4/);
    expect(adapters.m1.requests.length + adapters.m2.requests.length).toBe(before);
    expect(view.tasks).toHaveLength(0);

    // Same for a decision that is no longer the current verdict.
    await handle.db.update(schema.councilSession).set({ gateVersion: 2 }).where(eq(schema.councilSession.id, sessionId));
    await handle.db.update(schema.finalDecision).set({ supersededAt: new Date() }).where(eq(schema.finalDecision.sessionId, sessionId));
    await handle.db.update(schema.developmentPlan).set({ status: "queued", error: null }).where(eq(schema.developmentPlan.id, id));
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 }, id);
    expect((await getExecutionView(handle.db, actor, id)).plan).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/no longer the current verdict/),
    });
  });

  it("plans, implements in dependency order, tests in the sandbox, repairs and reviews", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false })).rejects.toMatchObject({ code: "CONFLICT" });
    const sandbox = new FakeSandbox((n) => (n === 1 ? "failed" : "passed"));
    await runExecution({ db: handle.db, resolveAdapter, sandbox, concurrency: 2 }, id);

    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    // The session's Execution Council phase mirrors the run, so the phase tabs never show "pending" after a run.
    const [stage] = await handle.db
      .select()
      .from(schema.workflowStage)
      .where(and(eq(schema.workflowStage.sessionId, sessionId), eq(schema.workflowStage.phase, "execution_council")));
    expect(stage!.status).toBe("completed");
    expect(view.tasks.map((t) => [t.key, t.status])).toEqual([
      ["T1", "done"],
      ["T2", "done"],
    ]);
    // T2 started after T1: its prompt already contained package.json.
    const t2Prompt = [...adapters.m1.requests, ...adapters.m2.requests].find((r) => r.messages[0]!.content.includes('key="T2"'))!;
    expect(t2Prompt.messages[0]!.content).toContain('<file path="package.json">');
    // Install with egress, tests offline; failed → repair → passed.
    expect(sandbox.runs.map((r) => [r.command, r.network])).toEqual([
      ["npm install", "egress"],
      ["npm test", "none"],
      ["npm install", "egress"],
      ["npm test", "none"],
    ]);
    expect(view.tests.map((t) => [t.kind, t.status])).toEqual([
      ["test:install", "passed"],
      ["test", "failed"],
      ["repair-1:install", "passed"],
      ["repair-1", "passed"],
    ]);
    expect(view.files.find((f) => f.path === "src/sum.js")!.content).toContain("a + b");
    expect(view.artifacts.filter((a) => a.path === "src/sum.js").map((a) => a.version)).toEqual([1, 2]);
    expect(view.reviews).toHaveLength(2);
    expect(view.reviews.every((r) => r.reviewerParticipantId !== view.plan.plannerParticipantId)).toBe(true);
    const patch = await exportPatch(handle.db, actor, id);
    expect(patch).toContain("+++ b/src/sum.js");
    expect(patch).toContain("+module.exports = (a, b) => a + b;");
  });

  it("retries a coding answer cut off at the output limit once with a larger, focused budget", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession({ truncatedFileChanges: 1 });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    expect(view.tasks.every((t) => t.status === "done")).toBe(true);
    const coding = [...adapters.m1.requests, ...adapters.m2.requests].filter((r) => r.jsonSchema?.name === "file_changes");
    const repaired = coding.filter((r) => r.maxOutputTokens === 32_000);
    expect(repaired.length).toBeGreaterThan(0);
    expect(repaired[0]!.messages[0]!.content).toContain("cut off at the output limit");
  });

  it("retries a coding answer that misses the schema once, naming what was wrong (GitHub build test 08.11.26)", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession({ malformedFileChanges: 1 });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    const coding = [...adapters.m1.requests, ...adapters.m2.requests].filter((r) => r.jsonSchema?.name === "file_changes");
    const corrected = coding.filter((r) => r.messages[0]!.content.includes("did not match the required JSON structure"));
    expect(corrected.length).toBeGreaterThan(0);
    expect(corrected[0]!.messages[0]!.content).toMatch(/summary: /);
  });

  it("resumes a failed run with only the failed task and keeps the finished work (#107)", async () => {
    // m2 implements T2 and is cut off twice (first answer and the larger retry), so T2 fails.
    const { sessionId, resolveAdapter, adapters } = await approvedSession({}, { truncatedFileChanges: 2 });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    const deps = { db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 };
    await runExecution(deps, id);
    let view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("failed");
    expect(view.tasks.map((t) => t.status)).toEqual(["done", "failed"]);
    const t1Before = view.tasks[0]!;
    const planCalls = () => [...Object.values(adapters)].flatMap((a) => a.requests).filter((r) => r.jsonSchema?.name === "development_plan").length;
    const codingCalls = () => [...Object.values(adapters)].flatMap((a) => a.requests).filter((r) => r.jsonSchema?.name === "file_changes");
    const t1Calls = codingCalls().filter((r) => r.messages[0]!.content.includes('key="T1"')).length;

    await expect(resumeExecution(handle.db, actor, id, { participantId: "par_unknown" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await resumeExecution(handle.db, actor, id)).toEqual({ status: "queued", tasks: ["T2"] });
    await expect(resumeExecution(handle.db, actor, id)).rejects.toMatchObject({ code: "CONFLICT" });
    await runExecution(deps, id);
    view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    expect(view.tasks.map((t) => t.status)).toEqual(["done", "done"]);
    // No new plan, T1 untouched, T2 ran once more on the same model.
    expect(planCalls()).toBe(1);
    expect(codingCalls().filter((r) => r.messages[0]!.content.includes('key="T1"')).length).toBe(t1Calls);
    expect(view.tasks[0]!.attempts).toBe(t1Before.attempts);
    expect(view.tasks[1]!.attempts).toBe(2);
    const audit = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, "execution.resumed"));
    expect(audit).toHaveLength(1);
  });

  it("hands a failed task to another council model only when asked, and stops after the attempt limit", async () => {
    const { sessionId, resolveAdapter } = await approvedSession({}, { truncatedFileChanges: 2 * MAX_TASK_ATTEMPTS });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    const deps = { db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 1 };
    await runExecution(deps, id);
    for (let attempt = 2; attempt <= MAX_TASK_ATTEMPTS; attempt++) {
      await resumeExecution(handle.db, actor, id);
      await runExecution(deps, id);
    }
    let view = await getExecutionView(handle.db, actor, id);
    expect(view.tasks[1]!.status).toBe("failed");
    expect(view.tasks[1]!.attempts).toBe(MAX_TASK_ATTEMPTS);
    await expect(resumeExecution(handle.db, actor, id)).rejects.toMatchObject({ code: "CONFLICT" });

    // A fresh run, where the user explicitly hands T2 to the other model after the first failure.
    const fresh = await approvedSession({}, { truncatedFileChanges: 2 });
    await submitApproval(handle.db, actor, fresh.sessionId, { action: "approve" });
    const run = await startExecution(handle.db, actor, fresh.sessionId, { requirePlanApproval: false });
    const freshDeps = { ...deps, resolveAdapter: fresh.resolveAdapter };
    await runExecution(freshDeps, run.id);
    view = await getExecutionView(handle.db, actor, run.id);
    const other = view.participants.find((p) => p.id !== view.tasks[1]!.assignedParticipantId)!;
    await resumeExecution(handle.db, actor, run.id, { participantId: other.id });
    await runExecution(freshDeps, run.id);
    view = await getExecutionView(handle.db, actor, run.id);
    expect(view.plan.status).toBe("completed");
    expect(view.tasks[1]!.assignedParticipantId).toBe(other.id);
  });

  it("stops after planning until a human approves the plan, then implements without re-planning (#45, #56)", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, {});
    const sandbox = new FakeSandbox(() => "passed");
    await runExecution({ db: handle.db, resolveAdapter, sandbox }, id);
    let view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("awaiting_plan_approval");
    expect(view.tasks.every((t) => t.status === "pending")).toBe(true);
    expect(view.files.some((f) => f.changed)).toBe(false);
    const planCalls = () => [...Object.values(adapters)].flatMap((a) => a.requests).filter((r) => r.jsonSchema?.name === "development_plan").length;
    expect(planCalls()).toBe(1);
    // A second worker pass does not continue on its own.
    await runExecution({ db: handle.db, resolveAdapter, sandbox }, id);
    expect((await getExecutionView(handle.db, actor, id)).plan.status).toBe("awaiting_plan_approval");

    await expect(decidePlan(handle.db, actor, id, { action: "approve", comment: "Looks good" })).resolves.toEqual({ status: "queued" });
    await runExecution({ db: handle.db, resolveAdapter, sandbox }, id);
    view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    expect(view.plan.planApprovedById).toBe(actor.userId);
    expect(planCalls()).toBe(1);
    await expect(decidePlan(handle.db, actor, id, { action: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never lets a parallel task silently overwrite another task's change to the same file (#24)", async () => {
    const { sessionId, resolveAdapter, adapters } = await approvedSession({ parallelSameFile: true });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed"), concurrency: 2 }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.tasks.map((t) => t.status)).toEqual(["done", "done"]);
    const shared = view.files.find((f) => f.path === "src/shared.js")!;
    expect(shared.content).toContain("export const a = 1;");
    expect(shared.content).toContain("export const b = 2;");
    const retried = [...Object.values(adapters)].flatMap((a) => a.requests).some((r) => r.messages[0]!.content.includes("another task changed src/shared.js"));
    expect(retried).toBe(true);
  });

  it("ends the run when the plan is rejected", async () => {
    const { sessionId, resolveAdapter } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, {});
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed") }, id);
    await decidePlan(handle.db, actor, id, { action: "reject", comment: "Too broad" });
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan).toMatchObject({ status: "cancelled", planFeedback: "Too broad" });
  });

  it("lets one chosen model plan and write every task while the others only review", async () => {
    const { sessionId, resolveAdapter } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const participants = await handle.db.select().from(schema.councilParticipant).where(eq(schema.councilParticipant.sessionId, sessionId));
    const builder = participants.find((p) => p.modelId === "m3")!;
    await expect(startExecution(handle.db, actor, sessionId, { requirePlanApproval: false, builderParticipantId: "par_unknown" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false, builderParticipantId: builder.id });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed") }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    expect(view.plan.plannerParticipantId).toBe(builder.id);
    expect(view.tasks.every((t) => t.assignedParticipantId === builder.id)).toBe(true);
    expect(view.reviews.length).toBeGreaterThan(0);
    expect(view.reviews.every((r) => r.reviewerParticipantId !== builder.id)).toBe(true);
  });

  it("does not run tests on an installation with SANDBOX_DISABLED and says they run in GitHub", async () => {
    const { detectSandbox, SANDBOX_DISABLED_REASON } = await import("../src/sandbox");
    const sandbox = await detectSandbox({ SANDBOX_DISABLED: "true" });
    expect(await sandbox.available()).toBe(false);
    expect(await sandbox.run({} as never)).toMatchObject({ status: "not_run", output: SANDBOX_DISABLED_REASON });
  });

  it("reports tests as not run when no sandbox exists and never fakes a pass", async () => {
    const { sessionId, resolveAdapter } = await approvedSession();
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { maxRepairAttempts: 2, requirePlanApproval: false });
    const { UnavailableSandbox } = await import("../src/sandbox");
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new UnavailableSandbox() }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.tests.map((t) => [t.kind, t.status])).toEqual([
      ["test:install", "not_run"],
      ["test", "not_run"],
    ]);
    expect(view.tests.some((t) => t.status === "passed")).toBe(false);
  });

  it("rejects unsafe file paths from the model", async () => {
    const { sessionId, resolveAdapter } = await approvedSession({ badPath: true });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed") }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.files.some((f) => f.path.includes(".."))).toBe(false);
    expect(view.executions.some((e) => e.summary.includes("path not allowed"))).toBe(true);
  });

  it("stops at its own budget and can be cancelled", async () => {
    const { sessionId, resolveAdapter } = await approvedSession({ outputTokens: 9_000 });
    await submitApproval(handle.db, actor, sessionId, { action: "approve" });
    const { id } = await startExecution(handle.db, actor, sessionId, { tokenBudget: 20_000, requirePlanApproval: false });
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed") }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("failed");
    expect(view.plan.error).toMatch(/budget/i);

    await handle.db.update(schema.councilSession).set({ status: "approved" }).where(eq(schema.councilSession.id, sessionId));
    const second = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
    await handle.db.update(schema.developmentPlan).set({ status: "running" }).where(eq(schema.developmentPlan.id, second.id));
    await cancelExecution(handle.db, actor, second.id);
    await runExecution({ db: handle.db, resolveAdapter, sandbox: new FakeSandbox(() => "passed") }, second.id);
    expect((await getExecutionView(handle.db, actor, second.id)).plan.status).toBe("cancelled");
  });
});
