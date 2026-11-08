/**
 * #249 part 2 (owner decision 08.11.26, variant B): a marked prototype/measurement build of an architecture candidate.
 * It starts while the verdict still waits for a decision, is stored as kind "prototype", and is never a regular build.
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import { createSession, getSessionView, recordMeasurement, runSession, submitApproval, type SessionInput } from "@consyrion/council";
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
} from "@consyrion/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listExecutions, startExecution } from "../src";
import { PROTOTYPE_TITLE_PREFIX } from "../src/github";
import { assertApprovalBuildable } from "../src/buildable";
import { ScriptedAdapter } from "../../council/test/scripted-adapter";
import { confirmProposedRequirements } from "../../council/test/confirm-requirements";

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

async function candidate() {
  const scores = (t: string) => (t === "Monolith" ? 9 : 6);
  const adapters = new Map(
    Object.entries({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } }).map(
      ([model, script]) => [model, new ScriptedAdapter(script)],
    ),
  );
  const participants = [...adapters.keys()].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
  const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true });
  await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
  const view = await getSessionView(handle.db, actor, id);
  return { id, proposalId: view.proposals[0]!.id, rhythmId: view.requirementList!.items.find((i) => /rhythmisch/.test(i.text))!.id };
}

describe("prototype / measurement build (#249 part 2, variant B)", () => {
  it("no build before a prototype approval; afterwards only a run of kind prototype, the verdict still waiting", async () => {
    const { id, proposalId } = await candidate();
    await expect(startExecution(handle.db, actor, id, { requirePlanApproval: true })).rejects.toMatchObject({ code: "CONFLICT" });
    // A favourite is no build approval either.
    await submitApproval(handle.db, actor, id, { action: "mark_favorite", selectedProposalId: proposalId, comment: "Best design" });
    await expect(startExecution(handle.db, actor, id, { requirePlanApproval: true })).rejects.toMatchObject({ code: "CONFLICT" });

    await submitApproval(handle.db, actor, id, { action: "approve_prototype", selectedProposalId: proposalId, comment: "Measure jitter" });
    const { id: planId } = await startExecution(handle.db, actor, id, { requirePlanApproval: true });
    const [plan] = await handle.db.select().from(schema.developmentPlan).where(eq(schema.developmentPlan.id, planId));
    expect(plan).toMatchObject({ kind: "prototype", proposalId });
    expect((await listExecutions(handle.db, actor, id))[0]).toMatchObject({ id: planId, kind: "prototype" });
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    expect(session!.status).toBe("awaiting_approval");
    const [audit] = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.targetId, planId));
    expect(audit!.metadata).toMatchObject({ kind: "prototype" });
    expect(PROTOTYPE_TITLE_PREFIX).toBe("[Prototype – not a finished solution] ");
  });

  it("a measured miss stops the prototype's way to a regular approval, and a regular approval is never assumed", async () => {
    const { id, proposalId, rhythmId } = await candidate();
    const [approval] = await handle.db
      .insert(schema.humanApproval)
      .values({
        id: "apr_fake",
        organizationId: actor.organizationId,
        sessionId: id,
        decisionId: (await getSessionView(handle.db, actor, id)).decision!.id,
        action: "approve_after_measurement",
        selectedProposalId: proposalId,
        requirementListId: (await getSessionView(handle.db, actor, id)).decision!.requirementListId,
        userId: "u1",
      })
      .returning();
    await handle.db.update(schema.councilSession).set({ status: "approved" }).where(eq(schema.councilSession.id, id));
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, id));
    // A forged "approved after measurement" without any measurement is refused when the build would start or resume.
    await expect(assertApprovalBuildable(handle.db, session!, approval!)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/Measurement still open/),
    });
    await handle.db.update(schema.councilSession).set({ status: "awaiting_approval" }).where(eq(schema.councilSession.id, id));
    await recordMeasurement(handle.db, actor, id, {
      proposalId,
      requirementId: rhythmId,
      method: "Loopback test",
      target: "≤ 25 ms",
      measured: "41 ms",
      met: false,
      evidence: "Log 10.11.",
    });
    await handle.db.update(schema.councilSession).set({ status: "approved" }).where(eq(schema.councilSession.id, id));
    await expect(assertApprovalBuildable(handle.db, session!, approval!)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/did not meet/),
    });
  });
});
