import { randomBytes } from "node:crypto";
import { DEFAULT_PLAN_CATALOG, keyringFromEnv } from "@consyrion/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { aiProviderCredential, project, subscription, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { createCredential, decryptCredentialForUse, rotateCredential } from "./credentials";
import { ensurePersonalOrganization } from "./organizations";
import { approximateCost, setPriceHint } from "./pricing";
import { deleteOrganization, deleteProjectPermanently, exportOrganization } from "./privacy";
import { createProject } from "./projects";
import { assertEntitlement, getEntitlements, getPlanCatalog, setSubscriptionPlan, updatePlanDefinition, usageThisMonth } from "./saas";
import { acceptInvitation, changeMemberRole, createInvitation, listMembers, removeMember } from "./team";

let handle: DatabaseHandle;
let owner: ActorContext;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
const brief = { idea: "A sufficiently long description of the project idea." };

async function addUser(id: string, email = `${id}@example.test`) {
  await handle.db.insert(user).values({ id, name: id, email });
}

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await addUser("owner");
  await addUser("admin");
  owner = await resolveActor(handle.db, "owner", (await ensurePersonalOrganization(handle.db, "owner", "Owner")).id);
});

afterEach(async () => {
  await handle.close();
});

describe("plans and entitlements (platform subscription, BYOK)", () => {
  it("seeds the catalog and defaults to Starter", async () => {
    expect((await getPlanCatalog(handle.db)).map((p) => p.key)).toEqual(DEFAULT_PLAN_CATALOG.map((p) => p.key));
    expect((await getEntitlements(handle.db, owner.organizationId)).plan).toBe("starter");
  });

  it("has no limits on a self-hosted installation (SELF_HOSTED=true)", async () => {
    process.env.SELF_HOSTED = "true";
    try {
      for (let i = 0; i < 5; i++) await createProject(handle.db, owner, { name: `P${i}`, type: "idea", brief });
      const { entitlements } = await getEntitlements(handle.db, owner.organizationId);
      expect(entitlements.executionCouncil).toBe(true);
      expect(entitlements.maxProjects).toBeGreaterThan(1000);
    } finally {
      delete process.env.SELF_HOSTED;
    }
  });

  it("blocks the fourth project on Starter and unlocks it on Pro", async () => {
    for (let i = 0; i < 3; i++) await createProject(handle.db, owner, { name: `P${i}`, type: "idea", brief });
    await expect(createProject(handle.db, owner, { name: "P4", type: "idea", brief })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/3 active project/) });
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "pro");
    await expect(createProject(handle.db, owner, { name: "P4", type: "idea", brief })).resolves.toBeTruthy();
  });

  it("rejects a plan for an unknown organization as NOT_FOUND without writing anything (#183)", async () => {
    await expect(setSubscriptionPlan(handle.db, "admin", "no-such-org", "business")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await handle.db.select().from(subscription).where(eq(subscription.organizationId, "no-such-org"))).toEqual([]);
  });

  it("gates features and falls back to Starter when a paid subscription is not active", async () => {
    await expect(assertEntitlement(handle.db, owner.organizationId, "execution")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "developer");
    await expect(assertEntitlement(handle.db, owner.organizationId, "execution")).resolves.toBeUndefined();
    await handle.db.update(subscription).set({ status: "past_due" }).where(eq(subscription.organizationId, owner.organizationId));
    expect((await getEntitlements(handle.db, owner.organizationId)).plan).toBe("starter");
    await expect(assertEntitlement(handle.db, owner.organizationId, "session", { participants: 6 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the platform admin edit limits with validation", async () => {
    const base = DEFAULT_PLAN_CATALOG[0]!;
    await updatePlanDefinition(handle.db, "admin", "starter", { name: "Free", entitlements: { ...base.entitlements, maxProjects: 1 }, priceLabel: "Free", stripePriceId: null, active: true });
    expect((await getEntitlements(handle.db, owner.organizationId)).entitlements.maxProjects).toBe(1);
    await expect(updatePlanDefinition(handle.db, "admin", "starter", { name: "x", entitlements: { ...base.entitlements, maxMembers: 0 }, priceLabel: null, stripePriceId: null, active: true })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reports usage without any AI credit or wallet concept", async () => {
    const usage = await usageThisMonth(handle.db, owner.organizationId);
    expect(usage).toMatchObject({ members: 1, projects: 0, sessions: 0, executions: 0, sandboxMinutes: 0, models: [] });
    expect(Object.keys(usage).some((k) => /credit|wallet|balance/i.test(k))).toBe(false);
    expect(approximateCost({ inputPerMillion: "3", outputPerMillion: "15" }, 1_000_000, 100_000)).toBe(4.5);
    expect(approximateCost(undefined, 1, 1)).toBeNull();
    await expect(setPriceHint(handle.db, owner, { provider: "openai", modelId: "x", inputPerMillion: "abc", outputPerMillion: "1", currency: "USD" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("team", () => {
  it("invites by link, binds to the e-mail address and enforces seats", async () => {
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "pro"); // 3 seats
    const { token } = await createInvitation(handle.db, owner, { email: "Mia@Example.test", role: "member" });
    await addUser("eve", "eve@example.test");
    await expect(acceptInvitation(handle.db, "eve", token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await addUser("mia", "mia@example.test");
    await acceptInvitation(handle.db, "mia", token);
    await expect(acceptInvitation(handle.db, "mia", token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listMembers(handle.db, owner)).map((m) => m.email).sort()).toEqual(["mia@example.test", "owner@example.test"]);
    await createInvitation(handle.db, owner, { email: "third@example.test", role: "viewer" });
    await expect(createInvitation(handle.db, owner, { email: "fourth@example.test", role: "viewer" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("protects roles and the last owner", async () => {
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "business");
    const { token } = await createInvitation(handle.db, owner, { email: "adm@example.test", role: "admin" });
    await addUser("adm", "adm@example.test");
    await acceptInvitation(handle.db, "adm", token);
    const admin = await resolveActor(handle.db, "adm", owner.organizationId);
    await expect(createInvitation(handle.db, admin, { email: "x@example.test", role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const members = await listMembers(handle.db, owner);
    const ownerMembership = members.find((m) => m.userId === "owner")!;
    await expect(changeMemberRole(handle.db, admin, ownerMembership.id, "viewer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeMemberRole(handle.db, owner, ownerMembership.id, "admin")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeMember(handle.db, owner, ownerMembership.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await removeMember(handle.db, admin, members.find((m) => m.userId === "adm")!.id); // leave
    await expect(resolveActor(handle.db, "adm", owner.organizationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("privacy and keys", () => {
  it("exports workspace data without secrets", async () => {
    await createCredential(handle.db, owner, keyring, { provider: "anthropic", secret: "sk-ant-export-test-000000001234" });
    await createProject(handle.db, owner, { name: "Exported", type: "idea", brief });
    const data = await exportOrganization(handle.db, owner);
    const json = JSON.stringify(data);
    expect(data.projects).toHaveLength(1);
    expect(json).not.toContain("sk-ant-export");
    expect(json).not.toContain("encryptedSecret");
  });

  it("deletes a project and the workspace only with confirmation", async () => {
    const p = await createProject(handle.db, owner, { name: "Gone", type: "idea", brief });
    await expect(deleteProjectPermanently(handle.db, owner, p.id, "wrong")).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteProjectPermanently(handle.db, owner, p.id, "Gone");
    expect(await handle.db.select().from(project).where(eq(project.id, p.id))).toHaveLength(0);
    await deleteOrganization(handle.db, owner, "Owner workspace");
    await expect(resolveActor(handle.db, "owner", owner.organizationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rotates a key and resets its check state", async () => {
    const c = await createCredential(handle.db, owner, keyring, { provider: "openai", secret: "sk-old-0000000000000000" });
    await handle.db.update(aiProviderCredential).set({ lastValidatedAt: new Date() }).where(eq(aiProviderCredential.id, c.id));
    await rotateCredential(handle.db, owner, keyring, c.id, "sk-new-1111111111111111");
    expect((await decryptCredentialForUse(handle.db, owner, keyring, c.id)).secret).toBe("sk-new-1111111111111111");
    const [row] = await handle.db.select().from(aiProviderCredential).where(eq(aiProviderCredential.id, c.id));
    expect(row).toMatchObject({ secretHint: "••••1111", lastValidatedAt: null });
  });
});

describe("platform overview", () => {
  it("counts members per workspace", async () => {
    const { platformOverview } = await import("./saas");
    const overview = await platformOverview(handle.db);
    expect(overview.list.find((o) => o.id === owner.organizationId)?.members).toBe(1);
  });
});
