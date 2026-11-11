import { randomBytes } from "node:crypto";
import { DEFAULT_PLAN_CATALOG, keyringFromEnv } from "@consyrium/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { aiProviderCredential, auditEvent, membership, planUsage, project, skill, skillVersion, subscription, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { createCredential, decryptCredentialForUse, rotateCredential } from "./credentials";
import { ensurePersonalOrganization } from "./organizations";
import { approximateCost, setPriceHint } from "./pricing";
import { deleteOrganization, deleteProjectPermanently, exportOrganization, purgeProject } from "./privacy";
import { createProject, getProject } from "./projects";
import {
  assertEntitlement,
  consumeMonthlyRun,
  getEntitlements,
  getPlanCatalog,
  recordSandboxUsage,
  refundMonthlyRun,
  setSubscriptionPlan,
  updatePlanDefinition,
  usageThisMonth,
} from "./saas";
import { acceptInvitation, changeMemberRole, createInvitation, listMembers, removeMember, revokeInvitation } from "./team";

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
    await expect(createProject(handle.db, owner, { name: "P4", type: "idea", brief })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/3 active project/),
    });
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
    await updatePlanDefinition(handle.db, "admin", "starter", {
      name: "Free",
      entitlements: { ...base.entitlements, maxProjects: 1 },
      priceLabel: "Free",
      stripePriceId: null,
      active: true,
    });
    expect((await getEntitlements(handle.db, owner.organizationId)).entitlements.maxProjects).toBe(1);
    await expect(
      updatePlanDefinition(handle.db, "admin", "starter", {
        name: "x",
        entitlements: { ...base.entitlements, maxMembers: 0 },
        priceLabel: null,
        stripePriceId: null,
        active: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reports usage without any AI credit or wallet concept", async () => {
    const usage = await usageThisMonth(handle.db, owner.organizationId);
    expect(usage).toMatchObject({ members: 1, projects: 0, sessions: 0, executions: 0, sandboxMinutes: 0, models: [] });
    expect(Object.keys(usage).some((k) => /credit|wallet|balance/i.test(k))).toBe(false);
    expect(approximateCost({ inputPerMillion: "3", outputPerMillion: "15" }, 1_000_000, 100_000)).toBe(4.5);
    expect(approximateCost(undefined, 1, 1)).toBeNull();
    await expect(
      setPriceHint(handle.db, owner, { provider: "openai", modelId: "x", inputPerMillion: "abc", outputPerMillion: "1", currency: "USD" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
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

describe("team hardening (#404)", () => {
  it("accepts an invitation only from a verified address while the server verifies addresses", async () => {
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "business");
    const { token } = await createInvitation(handle.db, owner, { email: "nora@example.test", role: "member" });
    await addUser("nora", "nora@example.test");
    await expect(acceptInvitation(handle.db, "nora", token, { requireVerifiedEmail: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await handle.db.update(user).set({ emailVerified: true }).where(eq(user.id, "nora"));
    await expect(acceptInvitation(handle.db, "nora", token, { requireVerifiedEmail: true })).resolves.toMatchObject({ id: owner.organizationId });
  });

  it("audits revoked invitations", async () => {
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "business");
    const { id } = await createInvitation(handle.db, owner, { email: "gone@example.test", role: "viewer" });
    await revokeInvitation(handle.db, owner, id);
    const events = await handle.db.select().from(auditEvent).where(eq(auditEvent.targetId, id));
    expect(events.map((e) => e.action).sort()).toEqual(["member.invitation_revoked", "member.invited"]);
  });

  it("keeps an owner when two owners demote each other at the same time", async () => {
    await setSubscriptionPlan(handle.db, "admin", owner.organizationId, "business");
    const { token } = await createInvitation(handle.db, owner, { email: "co@example.test", role: "owner" });
    await addUser("co", "co@example.test");
    await acceptInvitation(handle.db, "co", token);
    const co = await resolveActor(handle.db, "co", owner.organizationId);
    const members = await listMembers(handle.db, owner);
    const ownerId = members.find((m) => m.userId === "owner")!.id;
    const coId = members.find((m) => m.userId === "co")!.id;
    const results = await Promise.allSettled([changeMemberRole(handle.db, owner, coId, "admin"), changeMemberRole(handle.db, co, ownerId, "admin")]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await listMembers(handle.db, owner)).filter((m) => m.role === "owner")).toHaveLength(1);
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

  it("exports team skills and the user's own, not colleagues' private skills (#408)", async () => {
    await addUser("col", "col@example.test");
    await handle.db.insert(membership).values({ id: "mem_col", organizationId: owner.organizationId, userId: "col", role: "member" });
    const add = async (id: string, ownerUserId: string, visibility: "private" | "team") => {
      await handle.db.insert(skill).values({ id, organizationId: owner.organizationId, ownerUserId, name: id, visibility });
      await handle.db
        .insert(skillVersion)
        .values({
          id: `${id}_v1`,
          skillId: id,
          organizationId: owner.organizationId,
          version: 1,
          content: { knowledge: id },
          contentHash: id,
          createdById: ownerUserId,
        });
    };
    await add("skl_mine", "owner", "private");
    await add("skl_team", "col", "team");
    await add("skl_secret", "col", "private");
    const data = await exportOrganization(handle.db, owner);
    expect(data.skills.map((k) => k.id).sort()).toEqual(["skl_mine", "skl_team"]);
    expect(data.skillVersions.map((v) => v.skillId).sort()).toEqual(["skl_mine", "skl_team"]);
  });

  it("deletes a project and the workspace only with confirmation", async () => {
    const p = await createProject(handle.db, owner, { name: "Gone", type: "idea", brief });
    await expect(deleteProjectPermanently(handle.db, owner, p.id, "wrong")).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteProjectPermanently(handle.db, owner, p.id, "Gone");
    // #197: phase 1 hides and locks it at once; the purge job removes it (nothing runs here).
    await expect(getProject(handle.db, owner, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await purgeProject(handle.db, p.id, new Date())).toBe("done");
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

describe("#201 plan usage ledger: deleting data never gives back a month's runs", () => {
  async function bookSession(id: string) {
    await handle.db.transaction(async (tx) => consumeMonthlyRun(tx as never, owner.organizationId, "session", id));
  }

  it("a booked council stays counted after its project is deleted; the limit still applies", async () => {
    const limit = (await getEntitlements(handle.db, owner.organizationId)).entitlements.maxSessionsPerMonth;
    for (let i = 0; i < limit; i++) await bookSession(`ses_${i}`);
    const p = await createProject(handle.db, owner, { name: "Gone", type: "idea", brief });
    await deleteProjectPermanently(handle.db, owner, p.id, "Gone");
    expect((await usageThisMonth(handle.db, owner.organizationId)).sessions).toBe(limit);
    await expect(bookSession("ses_over")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertEntitlement(handle.db, owner.organizationId, "session")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is idempotent per run, and concurrent starts on the last slot book only one", async () => {
    const limit = (await getEntitlements(handle.db, owner.organizationId)).entitlements.maxSessionsPerMonth;
    for (let i = 0; i < limit - 1; i++) await bookSession(`ses_${i}`);
    await bookSession("ses_0"); // a retry of the same start books nothing twice
    const results = await Promise.allSettled([bookSession("ses_a"), bookSession("ses_b"), bookSession("ses_c")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await usageThisMonth(handle.db, owner.organizationId)).sessions).toBe(limit);
  });

  it("refunds a slot once, books sandbox time once per test run, and stores no content", async () => {
    await bookSession("ses_x");
    await refundMonthlyRun(handle.db, owner.organizationId, "session", "ses_x");
    await refundMonthlyRun(handle.db, owner.organizationId, "session", "ses_x");
    expect((await usageThisMonth(handle.db, owner.organizationId)).sessions).toBe(0);
    await recordSandboxUsage(handle.db, owner.organizationId, "tst_1", 90_000);
    await recordSandboxUsage(handle.db, owner.organizationId, "tst_1", 90_000);
    expect((await usageThisMonth(handle.db, owner.organizationId)).sandboxMinutes).toBe(2);
    const rows = await handle.db.select().from(planUsage).where(eq(planUsage.organizationId, owner.organizationId));
    expect(Object.keys(rows[0]!).sort()).toEqual(["amount", "createdAt", "id", "kind", "organizationId", "refId"]);
  });

  it("another workspace's ledger is never counted", async () => {
    await bookSession("ses_mine");
    await addUser("other");
    const other = await resolveActor(handle.db, "other", (await ensurePersonalOrganization(handle.db, "other", "Other")).id);
    expect((await usageThisMonth(handle.db, other.organizationId)).sessions).toBe(0);
  });
});
