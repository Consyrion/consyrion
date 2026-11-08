/**
 * #197 (ADR 0197) PR 1 – an archived project is read-only: no brief change, no requirement confirmation, no document,
 * no council, approval, mark or measurement; reading stays possible; restore brings it back (plan limit applies).
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import {
  archiveProject,
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  getProject,
  resolveActor,
  restoreProject,
  schema,
  setSubscriptionPlan,
  updateBrief,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, getSessionView, listSessions, runSession, submitApproval, type SessionInput } from "../src";
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

async function finishedSession() {
  const scores = (t: string) => (t === "Monolith" ? 9 : 6);
  const adapters = new Map(
    Object.entries({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } }).map(
      ([m, s]) => [m, new ScriptedAdapter(s)],
    ),
  );
  const participants = [...adapters.keys()].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
  const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true });
  await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
  return id;
}

describe("archived projects are read-only (#197, ADR 0197)", () => {
  it("refuses brief changes, approvals and new councils; reading and the session list stay available", async () => {
    const sessionId = await finishedSession();
    await archiveProject(handle.db, actor, projectId);
    await archiveProject(handle.db, actor, projectId); // repeated: no change, no error
    await expect(updateBrief(handle.db, actor, projectId, { idea: "Design a scheduling SaaS for 200 clinics in Germany." })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/archived/),
    });
    await expect(submitApproval(handle.db, actor, sessionId, { action: "approve" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/archived/),
    });
    const participants = ["m1", "m2", "m3"].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
    await expect(createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // Reading still works.
    expect((await getSessionView(handle.db, actor, sessionId)).decision).not.toBeNull();
    expect((await listSessions(handle.db, actor)).find((s) => s.id === sessionId)).toMatchObject({ projectStatus: "archived" });
  });

  it("restore makes it writable again and is audited; only an archived project can be restored", async () => {
    const sessionId = await finishedSession();
    await expect(restoreProject(handle.db, actor, projectId)).rejects.toMatchObject({ code: "CONFLICT" });
    await archiveProject(handle.db, actor, projectId);
    await restoreProject(handle.db, actor, projectId);
    expect((await getProject(handle.db, actor, projectId)).status).toBe("ready");
    expect((await submitApproval(handle.db, actor, sessionId, { action: "approve" })).status).toBe("approved");
    const audit = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.targetId, projectId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["project.archived", "project.restored"]));
  });
});
