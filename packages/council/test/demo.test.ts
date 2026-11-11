import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createCredential,
  addDocument,
  confirmRequirementList,
  createDatabase,
  createProject,
  updateBrief,
  ensureDemoProject,
  ensurePersonalOrganization,
  getDemoTemplates,
  listProjects,
  resolveActor,
  schema,
  setDemoTemplate,
  setSubscriptionPlan,
  usageThisMonth,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, getSessionView, runSession, submitApproval } from "../src";
import { confirmProposedRequirements } from "./confirm-requirements";
import { ScriptedAdapter } from "./scripted-adapter";

let handle: DatabaseHandle;
let admin: ActorContext;
let customer: ActorContext;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values([
    { id: "admin", name: "Admin", email: "admin@example.test" },
    { id: "cust", name: "Customer", email: "cust@example.test" },
  ]);
  const a = await ensurePersonalOrganization(handle.db, "admin", "Admin");
  admin = await resolveActor(handle.db, "admin", a.id);
  await setSubscriptionPlan(handle.db, "admin", a.id, "business");
  const c = await ensurePersonalOrganization(handle.db, "cust", "Customer");
  customer = await resolveActor(handle.db, "cust", c.id);
});

afterEach(async () => {
  await handle.close();
});

async function finishedCouncil() {
  const projectId = (
    await createProject(handle.db, admin, {
      name: "Broker choice",
      type: "technology_choice",
      brief: { idea: "Which message broker fits a small team?", requirements: "Must run on one server." },
    })
  ).id;
  const credentialId = (await createCredential(handle.db, admin, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, admin, projectId);
  const adapters = new Map([
    ["m1", new ScriptedAdapter({ title: "Redis streams", score: (t) => (t === "Redis streams" ? 9 : 6) })],
    ["m2", new ScriptedAdapter({ title: "RabbitMQ", score: (t) => (t === "Redis streams" ? 9 : 6) })],
    ["m3", new ScriptedAdapter({ title: "PostgreSQL queue", score: (t) => (t === "Redis streams" ? 9 : 6) })],
  ]);
  const input = { mode: "independent_expert" as const, participants: [...adapters.keys()].map((modelId) => ({ credentialId, modelId })), confirmBudget: true };
  const { id } = await createSession(handle.db, admin, projectId, input);
  await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
  return { id, input };
}

describe("demo project (owner decision 08.11.26)", () => {
  it("copies a finished council once into a customer workspace, read-only and outside the plan", async () => {
    const { id: templateId, input } = await finishedCouncil();
    expect(await ensureDemoProject(handle.db, customer, "de")).toBeNull(); // no template yet
    await setDemoTemplate(handle.db, admin, "en", templateId);
    expect(await getDemoTemplates(handle.db)).toEqual({ en: templateId });

    const projectId = await ensureDemoProject(handle.db, customer, "de"); // falls back to English
    expect(projectId).toBeTruthy();
    expect(await ensureDemoProject(handle.db, customer, "de")).toBeNull(); // only once

    const [project] = (await listProjects(handle.db, customer)).filter((p) => p.id === projectId);
    expect(project).toMatchObject({ isDemo: true, name: "Demo: Broker choice", organizationId: customer.organizationId });
    const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.projectId, projectId!));
    const copy = await getSessionView(handle.db, customer, session!.id);
    const original = await getSessionView(handle.db, admin, templateId);
    expect(copy.proposals.map((p) => p.label)).toEqual(original.proposals.map((p) => p.label));
    expect(copy.decision?.outcome).toBe(original.decision?.outcome);
    expect(copy.project.isDemo).toBe(true);
    // Every id inside the verdict points to the copy, none to the template workspace.
    const recommended = copy.decision?.recommendedProposalId;
    if (recommended) expect(copy.proposals.some((p) => p.id === recommended)).toBe(true);
    expect(JSON.stringify(copy)).not.toContain(templateId);
    expect(copy.participants.every((p) => (p as { credentialId?: string | null }).credentialId == null)).toBe(true);

    await expect(createSession(handle.db, customer, projectId!, input)).rejects.toThrow(/demo project/);
    await expect(submitApproval(handle.db, customer, session!.id, { action: "approve" })).rejects.toThrow(/demo project/);
    // Review of #374: every other write path refuses too.
    await expect(updateBrief(handle.db, customer, projectId!, { idea: "Changed" })).rejects.toThrow(/demo project/);
    await expect(
      addDocument(handle.db, customer, projectId!, { name: "x.md", mimeType: "text/markdown", bytes: new TextEncoder().encode("x") }),
    ).rejects.toThrow(/demo project/);
    await expect(confirmRequirementList(handle.db, customer, projectId!, { items: [], noHardRequirements: true } as never)).rejects.toThrow(/demo project/);
    expect(session!.skill).toBeNull();
    const usage = await usageThisMonth(handle.db, customer.organizationId);
    expect(usage.projects).toBe(0);
    expect(usage.sessions).toBe(0);
  });

  it("accepts only finished councils of the admin's own workspace as template", async () => {
    const { id } = await finishedCouncil();
    await expect(setDemoTemplate(handle.db, customer, "en", id)).rejects.toThrow(/finished council of your own workspace/);
  });
});
