/**
 * #197 (ADR 0197) PR 2 – two-phase project deletion: the request hides and locks the project at once and stops its
 * councils, builds and jobs; the purge removes every dependent row once nothing runs. The plan usage ledger (#201) stays.
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createCredential,
  createDatabase,
  createProject,
  deleteProjectPermanently,
  ensurePersonalOrganization,
  getProject,
  PROJECT_PURGE_JOB,
  PROJECT_PURGE_MAX_WAIT_MS,
  purgeProject,
  resolveActor,
  schema,
  setSubscriptionPlan,
  usageThisMonth,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, deleteSession, getSessionView, listSessions, runSession, submitApproval, type SessionInput } from "../src";
import { ScriptedAdapter } from "./scripted-adapter";
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
      name: "Clinic",
      type: "architecture",
      brief: { idea: "Design a scheduling SaaS for 120 clinics.", requirements: "Health data must stay in Germany." },
    })
  ).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, actor, projectId);
});

afterEach(async () => {
  await handle.close();
});

const participants = () => ["m1", "m2", "m3"].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
async function startSession() {
  return (await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants: participants(), confirmBudget: true })).id;
}
async function finishedSession() {
  const scores = (t: string) => (t === "Monolith" ? 9 : 6);
  const adapters = new Map(
    Object.entries({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } }).map(
      ([m, s]) => [m, new ScriptedAdapter(s)],
    ),
  );
  const id = await startSession();
  await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
  return id;
}
const purgeJob = async () => (await handle.db.select().from(schema.job).where(eq(schema.job.kind, PROJECT_PURGE_JOB)))[0];
/** Rows that still point to the project (directly or through its sessions) in the main dependent tables. */
async function leftovers(sessionIds: string[]) {
  const count = async (table: string, column: string, ids: string[]) =>
    ids.length
      ? Number(
          (
            (await handle.db.execute(
              sql.raw(`select count(*)::int as n from ${table} where ${column} in (${ids.map((i) => `'${i}'`).join(",")})`),
            )) as unknown as { rows: Array<{ n: number }> }
          ).rows[0]!.n,
        )
      : 0;
  return {
    project: await count("project", "id", [projectId]),
    briefs: await count("project_brief", "project_id", [projectId]),
    lists: await count("requirement_list", "project_id", [projectId]),
    sessions: await count("council_session", "id", sessionIds),
    proposals: await count("proposal", "session_id", sessionIds),
    decisions: await count("final_decision", "session_id", sessionIds),
    approvals: await count("human_approval", "session_id", sessionIds),
    rounds: await count("evaluation_round", "session_id", sessionIds),
    checks: await count("requirement_check", "session_id", sessionIds),
    usage: await count("usage_record", "session_id", sessionIds),
  };
}

describe("two-phase project deletion (#197, ADR 0197)", () => {
  it("full project: hidden and locked at once, queued council and its job stopped, every dependent row purged, ledger kept", async () => {
    const done = await finishedSession();
    await submitApproval(handle.db, actor, done, { action: "approve" });
    const queued = await startSession();
    const before = (await usageThisMonth(handle.db, actor.organizationId)).sessions;

    await expect(deleteProjectPermanently(handle.db, actor, projectId, "wrong")).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteProjectPermanently(handle.db, actor, projectId, "Clinic");
    await deleteProjectPermanently(handle.db, actor, projectId, "Clinic"); // repeated while deleting: no change
    await expect(getProject(handle.db, actor, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getSessionView(handle.db, actor, done)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listSessions(handle.db, actor)).map((s) => s.id)).not.toContain(done);
    const [q] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, queued));
    expect(q!.status).toBe("cancelled");
    const councilJobs = await handle.db
      .select()
      .from(schema.job)
      .where(sql`${schema.job.payload}->>'sessionId' = ${queued}`);
    expect(councilJobs.every((j) => j.status === "failed")).toBe(true);
    expect(await handle.db.select().from(schema.job).where(eq(schema.job.kind, PROJECT_PURGE_JOB))).toHaveLength(1);

    const job = await purgeJob();
    expect(await purgeProject(handle.db, projectId, new Date(String(job!.payload.requestedAt)))).toBe("done");
    expect(await leftovers([done, queued])).toEqual({
      project: 0,
      briefs: 0,
      lists: 0,
      sessions: 0,
      proposals: 0,
      decisions: 0,
      approvals: 0,
      rounds: 0,
      checks: 0,
      usage: 0,
    });
    // #201: the month's councils stay counted.
    expect((await usageThisMonth(handle.db, actor.organizationId)).sessions).toBe(before);
    // Purging again and deleting again end the same way.
    expect(await purgeProject(handle.db, projectId, new Date())).toBe("done");
    await expect(deleteProjectPermanently(handle.db, actor, projectId, "Clinic")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const audit = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.targetId, projectId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["privacy.project_deletion_requested", "privacy.project_deleted"]));
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Clinic|scheduling/);
  });

  it("a running council is asked to stop; the purge waits while it runs and deletes after the maximum wait", async () => {
    const running = await startSession();
    await handle.db.update(schema.councilSession).set({ status: "running" }).where(eq(schema.councilSession.id, running));
    await handle.db
      .update(schema.job)
      .set({ status: "running", lockedUntil: new Date(Date.now() + 60_000) })
      .where(sql`${schema.job.payload}->>'sessionId' = ${running}`);
    await deleteProjectPermanently(handle.db, actor, projectId, "Clinic");
    const [s] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, running));
    expect(s!.status).toBe("cancel_requested");
    const requestedAt = new Date();
    expect(await purgeProject(handle.db, projectId, requestedAt)).toBe("wait");
    // The worker stopped it: nothing runs any more.
    await handle.db.update(schema.councilSession).set({ status: "cancelled" }).where(eq(schema.councilSession.id, running));
    await handle.db
      .update(schema.job)
      .set({ status: "done", lockedUntil: null })
      .where(sql`${schema.job.payload}->>'sessionId' = ${running}`);
    expect(await purgeProject(handle.db, projectId, requestedAt)).toBe("done");
  });

  it("a council that never stops is purged after the maximum wait", async () => {
    const stuck = await startSession();
    await handle.db.update(schema.councilSession).set({ status: "running" }).where(eq(schema.councilSession.id, stuck));
    await deleteProjectPermanently(handle.db, actor, projectId, "Clinic");
    const requestedAt = new Date(Date.now() - PROJECT_PURGE_MAX_WAIT_MS - 1000);
    expect(await purgeProject(handle.db, projectId, requestedAt)).toBe("done");
    const audit = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, "privacy.project_deleted"));
    expect(audit[0]!.metadata).toMatchObject({ forcedAfterWait: true });
  });

  it("refuses a viewer and another workspace without touching the project", async () => {
    await handle.db.insert(schema.user).values({ id: "u2", name: "Other", email: "x@example.test" });
    const other = await resolveActor(handle.db, "u2", (await ensurePersonalOrganization(handle.db, "u2", "Other")).id);
    await expect(deleteProjectPermanently(handle.db, other, projectId, "Clinic")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteProjectPermanently(handle.db, { ...actor, role: "viewer" }, projectId, "Clinic")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getProject(handle.db, actor, projectId)).status).toBe("ready");
  });
});

describe("#198 deleting one session (whole session, never a single verdict)", () => {
  it("removes only that session with its verdicts and approvals; project, briefs, lists, other sessions and the ledger stay", async () => {
    const keep = await finishedSession();
    const gone = await finishedSession();
    await submitApproval(handle.db, actor, gone, { action: "approve" });
    const before = (await usageThisMonth(handle.db, actor.organizationId)).sessions;
    await expect(deleteSession(handle.db, actor, gone, "wrong")).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteSession(handle.db, actor, gone, "Clinic");
    await expect(getSessionView(handle.db, actor, gone)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getSessionView(handle.db, actor, keep)).decision).not.toBeNull();
    const left = await leftovers([gone]);
    expect(left).toMatchObject({ project: 1, sessions: 0, proposals: 0, decisions: 0, approvals: 0, rounds: 0, checks: 0, usage: 0 });
    expect(left.briefs).toBeGreaterThan(0);
    expect(left.lists).toBeGreaterThan(0);
    expect((await usageThisMonth(handle.db, actor.organizationId)).sessions).toBe(before);
    const [audit] = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, "privacy.session_deleted"));
    expect(audit!.metadata).toMatchObject({ sessionId: gone, verdicts: 1, builds: 0 });
    // Deleting again: the session is gone.
    await expect(deleteSession(handle.db, actor, gone, "Clinic")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a running council and an active build, a viewer and another workspace", async () => {
    const running = await startSession();
    await expect(deleteSession(handle.db, actor, running, "Clinic")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/still running/),
    });
    const done = await finishedSession();
    const [decision] = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, done));
    const [proposal] = await handle.db.select().from(schema.proposal).where(eq(schema.proposal.sessionId, done));
    const [participant] = await handle.db.select().from(schema.councilParticipant).where(eq(schema.councilParticipant.sessionId, done));
    await handle.db.insert(schema.humanApproval).values({
      id: "apr_t",
      organizationId: actor.organizationId,
      sessionId: done,
      decisionId: decision!.id,
      action: "approve",
      selectedProposalId: proposal!.id,
      userId: "u1",
    });
    await handle.db.insert(schema.developmentPlan).values({
      id: "pln_t",
      organizationId: actor.organizationId,
      sessionId: done,
      approvalId: "apr_t",
      proposalId: proposal!.id,
      plannerParticipantId: participant!.id,
      status: "running",
      tokenBudget: 1000,
      createdById: "u1",
    });
    await expect(deleteSession(handle.db, actor, done, "Clinic")).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/build/) });
    await expect(deleteSession(handle.db, { ...actor, role: "viewer" }, done, "Clinic")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await handle.db.insert(schema.user).values({ id: "u3", name: "Other", email: "z@example.test" });
    const other = await resolveActor(handle.db, "u3", (await ensurePersonalOrganization(handle.db, "u3", "Other")).id);
    await expect(deleteSession(handle.db, other, done, "Clinic")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
