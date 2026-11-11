/**
 * Expert profiles in the SkillHub (owner decision 08.11.26): an own profile is submitted through the hub pipeline,
 * published, and adopted by another workspace as a private copy with its origin. Imitations of real people never reach
 * the hub; a team member cannot publish someone else's profile.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { roleProfile, skill, skillVersion, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { ensurePersonalOrganization } from "./organizations";
import { createRoleProfile, getRoleProfile, listRoleProfiles, ownRoleProfileForPublication } from "./role-profiles";
import { setSubscriptionPlan } from "./saas";
import { adoptPublicSkill } from "./skill-catalog";
import { claimPublisherHandle, saveHubDraft, submitSkillForPublication } from "./skill-hub";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;
const now = new Date("2026-11-08T12:00:00Z");
const profile = {
  role: "cost_analyst",
  name: "Finance expert",
  coreQuestion: "What does this cost per month at the expected load, and what makes it jump?",
  lenses: ["Fixed vs. variable cost", "Egress and storage growth", "Exit cost of the vendor"],
  notSuitableFor: "Tax and legal questions.",
  sources: [{ title: "FinOps basics", url: "https://example.org/finops", status: "verified", checkedAt: "2026-11-01", note: null }],
};

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.test", emailVerified: true, createdAt: new Date("2026-09-01") },
    { id: "bob", name: "Bob", email: "bob@example.test", emailVerified: true },
  ]);
  const orgA = (await ensurePersonalOrganization(handle.db, "alice", "Alice")).id;
  await setSubscriptionPlan(handle.db, "alice", orgA, "pro");
  alice = await resolveActor(handle.db, "alice", orgA);
  const orgB = (await ensurePersonalOrganization(handle.db, "bob", "Bob")).id;
  await setSubscriptionPlan(handle.db, "bob", orgB, "pro");
  bob = await resolveActor(handle.db, "bob", orgB);
  await claimPublisherHandle(handle.db, alice, "alice");
});

afterAll(async () => {
  await handle.close();
});

describe("expert profiles in the SkillHub", () => {
  it("publishes an own profile and adopts it elsewhere as a private copy with its origin", async () => {
    const { id } = await createRoleProfile(handle.db, alice, { content: profile });
    const own = await ownRoleProfileForPublication(handle.db, alice, id);
    const draft = await saveHubDraft(handle.db, alice, { kind: "role_profile", sourceId: id, name: own.name, content: own.content });
    const submitted = await submitSkillForPublication(
      handle.db,
      alice,
      draft.skillId,
      { license: "CC-BY-4.0", changelog: "First version.", slug: "finance-expert" },
      now,
    );
    expect(submitted.status).not.toBe("published");
    // The admin decision itself is tested with the hub moderation.
    await handle.db.update(skillVersion).set({ reviewStatus: "published", publishedAt: now }).where(eq(skillVersion.skillId, draft.skillId));
    await handle.db.update(skill).set({ publicVersion: draft.version }).where(eq(skill.id, draft.skillId));

    const copy = (await adoptPublicSkill(handle.db, bob, "alice", "finance-expert")) as { id: string };
    const [row] = await handle.db.select().from(roleProfile).where(eq(roleProfile.id, copy.id));
    expect(row).toMatchObject({
      organizationId: bob.organizationId,
      ownerUserId: "bob",
      visibility: "private",
      forkedFrom: { name: "@alice/finance-expert", version: draft.version },
    });
    expect((await getRoleProfile(handle.db, bob, copy.id)).snapshot.content).toEqual(own.content);
    expect((await listRoleProfiles(handle.db, bob)).some((p) => p.id === copy.id)).toBe(true);
  });

  it("only the author publishes; an imitation of a real person never reaches the hub", async () => {
    const { id } = await createRoleProfile(handle.db, alice, { content: { ...profile, name: "Cost guard" } });
    await expect(ownRoleProfileForPublication(handle.db, { ...bob, organizationId: alice.organizationId }, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveHubDraft(handle.db, alice, {
        kind: "role_profile",
        sourceId: id,
        name: "x",
        content: { ...profile, coreQuestion: "Denke wie Elon Musk: Was kann weg?" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("adopting twice", () => {
  it("returns the existing copy of the same version instead of a duplicate", async () => {
    const { id } = await createRoleProfile(handle.db, alice, { content: { ...profile, name: "Twice adopted" } });
    const draft = await saveHubDraft(handle.db, alice, {
      kind: "role_profile",
      sourceId: id,
      name: "Twice adopted",
      content: { ...profile, name: "Twice adopted" },
    });
    await submitSkillForPublication(handle.db, alice, draft.skillId, { license: "CC-BY-4.0", changelog: "v1", slug: "twice-adopted" }, now);
    await handle.db.update(skillVersion).set({ reviewStatus: "published", publishedAt: now }).where(eq(skillVersion.skillId, draft.skillId));
    await handle.db.update(skill).set({ publicVersion: draft.version }).where(eq(skill.id, draft.skillId));
    const first = (await adoptPublicSkill(handle.db, bob, "alice", "twice-adopted")) as { id: string };
    const second = (await adoptPublicSkill(handle.db, bob, "alice", "twice-adopted")) as { id: string; alreadyAdopted?: boolean };
    expect(second).toEqual({ id: first.id, alreadyAdopted: true });
  });
});
