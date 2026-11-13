import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { skill, skillModerationLog, skillPublisher, skillReport, skillVersion, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { resolvePlatformAdmin, type PlatformAdminContext } from "./feedback";
import { ensurePersonalOrganization } from "./organizations";
import { setSubscriptionPlan } from "./saas";
import {
  adoptPublicSkill,
  getPublicSkill,
  listOfficialSkillsForAdmin,
  listOpenSkillReports,
  CATALOG_PAGE_SIZE,
  listPublicSkills,
  listPublicSkillsPage,
  reportPublicSkill,
  resolveSkillReport,
  setOfficialSkillHidden,
} from "./skill-catalog";
import { countNewFeedback } from "./feedback";
import { OFFICIAL_SKILLS, scanSkillForPublication } from "@consyrium/core";
import { claimPublisherHandle, saveHubDraft, submitSkillForPublication } from "./skill-hub";
import { archiveSkill, createSkill, getSkillForUse, listSkills } from "./skills";
import { createRoleProfile, listRoleProfiles } from "./role-profiles";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;
let admin: PlatformAdminContext;
const now = new Date("2026-11-08T12:00:00Z");

const content = (name: string, summary = "Compare hosting options for a small SaaS.") => ({
  name,
  summary,
  category: "architecture",
  knowledge: "Check data location and restore tests.",
});

/** Submits and publishes (the admin decision itself is tested in skill-moderation.test.ts). */
async function published(name: string, extra: { listed?: boolean; summary?: string } = {}) {
  const id = (await createSkill(handle.db, alice, { content: content(name, extra.summary) })).id;
  await submitSkillForPublication(handle.db, alice, id, { license: "CC-BY-4.0", changelog: "First version.", listed: extra.listed }, now);
  await handle.db.update(skillVersion).set({ reviewStatus: "published", publishedAt: now }).where(eq(skillVersion.skillId, id));
  await handle.db.update(skill).set({ publicVersion: 1 }).where(eq(skill.id, id));
  return id;
}

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.test", emailVerified: true, createdAt: new Date("2026-09-01") },
    { id: "bob", name: "Bob", email: "bob@example.test", emailVerified: true },
    { id: "root", name: "Admin", email: "admin@example.test", emailVerified: true },
  ]);
  const orgA = (await ensurePersonalOrganization(handle.db, "alice", "Alice")).id;
  await setSubscriptionPlan(handle.db, "root", orgA, "pro");
  alice = await resolveActor(handle.db, "alice", orgA);
  const orgB = (await ensurePersonalOrganization(handle.db, "bob", "Bob")).id;
  await setSubscriptionPlan(handle.db, "root", orgB, "pro"); // several adoptions in these tests
  bob = await resolveActor(handle.db, "bob", orgB);
  await claimPublisherHandle(handle.db, alice, "alice");
  admin = await resolvePlatformAdmin(handle.db, "root", ["admin@example.test"]);
});

afterAll(async () => {
  await handle.close();
});

describe("public catalog (#368 PR 6)", () => {
  it("shows only published, listed, visible skills of active publishers", async () => {
    const listedId = await published("Public hosting review");
    await published("Unlisted check", { listed: false });
    const draft = (await createSkill(handle.db, alice, { content: content("Private draft") })).id;
    await submitSkillForPublication(handle.db, alice, draft, { license: "CC-BY-4.0", changelog: "x" }, now); // pending, not public

    const names = (await listPublicSkills(handle.db)).filter((s) => s.handle === "alice").map((s) => s.name);
    expect(names).toEqual(["Public hosting review"]);
    expect(await getPublicSkill(handle.db, "@alice", "unlisted-check")).toMatchObject({ name: "Unlisted check", listed: false }); // by link
    expect(await getPublicSkill(handle.db, "alice", "private-draft")).toBeNull();

    await handle.db.update(skill).set({ hiddenAt: now, hiddenReason: "x" }).where(eq(skill.id, listedId));
    expect(await getPublicSkill(handle.db, "alice", "public-hosting-review")).toBeNull();
    await handle.db.update(skill).set({ hiddenAt: null, hiddenReason: null }).where(eq(skill.id, listedId));

    await handle.db.update(skillPublisher).set({ suspendedAt: now }).where(eq(skillPublisher.userId, "alice"));
    expect((await listPublicSkills(handle.db)).filter((s) => s.handle === "alice")).toEqual([]);
    await handle.db.update(skillPublisher).set({ suspendedAt: null }).where(eq(skillPublisher.userId, "alice"));
  });

  it("searches name, summary and handle and filters by category; never shows a later unreviewed version", async () => {
    await published("Vendor scoring", { summary: "Score cloud vendors by contract terms." });
    expect((await listPublicSkills(handle.db, { q: "contract" })).filter((s) => s.handle === "alice").map((s) => s.name)).toEqual(["Vendor scoring"]);
    expect((await listPublicSkills(handle.db, { q: "ALICE" })).length).toBeGreaterThan(1);
    expect((await listPublicSkills(handle.db, { category: "cost" })).map((s) => s.handle)).toEqual(["consyrium"]);
    expect(await listPublicSkills(handle.db, { q: "%" })).toEqual([]);
  });

  it("adopts a public skill as the caller's own private copy, and other workspaces still cannot read the original", async () => {
    const copy = await adoptPublicSkill(handle.db, bob, "alice", "public-hosting-review");
    // a second click returns the same copy (Gesamttest 3)
    expect(await adoptPublicSkill(handle.db, bob, "alice", "public-hosting-review")).toEqual({ id: copy.id, alreadyAdopted: true });
    const own = (await listSkills(handle.db, bob)).find((s) => s.id === copy.id);
    expect(own).toMatchObject({ visibility: "private", editable: true, forkedFrom: { name: "@alice/public-hosting-review", version: 1 } });
    expect((await getPublicSkill(handle.db, "alice", "public-hosting-review"))?.uses).toBe(1);
    await adoptPublicSkill(handle.db, alice, "alice", "public-hosting-review"); // the author's own workspace
    expect((await getPublicSkill(handle.db, "alice", "public-hosting-review"))?.uses).toBe(1);
    const original = (await getPublicSkill(handle.db, "alice", "public-hosting-review"))!.skillId;
    await expect(getSkillForUse(handle.db, bob, original)).rejects.toThrow(/not found/i);
  });

  it("takes reports once per user into the admin queue without hiding anything", async () => {
    await expect(reportPublicSkill(handle.db, bob, { handle: "alice", slug: "public-hosting-review", reason: "nonsense" })).rejects.toThrow(/reason/);
    await reportPublicSkill(handle.db, bob, { handle: "alice", slug: "public-hosting-review", reason: "misleading", note: "Claims without source." });
    await expect(reportPublicSkill(handle.db, bob, { handle: "alice", slug: "public-hosting-review", reason: "spam" })).rejects.toThrow(/already reported/);
    expect(await getPublicSkill(handle.db, "alice", "public-hosting-review")).not.toBeNull();

    const reports = await listOpenSkillReports(handle.db, admin);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reason: "misleading", handle: "alice", openOnSkill: 1 });
    await expect(listOpenSkillReports(handle.db, { userId: "bob", email: "x" } as PlatformAdminContext)).rejects.toThrow(/Not found/);

    await resolveSkillReport(handle.db, admin, reports[0]!.id, "dismissed", now);
    expect(await listOpenSkillReports(handle.db, admin)).toEqual([]);
    const [report] = await handle.db.select().from(skillReport);
    expect(report).toMatchObject({ status: "dismissed", resolvedById: "root" });
    const log = await handle.db.select().from(skillModerationLog).where(eq(skillModerationLog.skillId, report!.skillId));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["report", "report_resolved"]));
  });
});

describe("official skills in the catalog (#368 PR 7)", () => {
  it("every official skill passes the publication scan green (CI fails otherwise)", () => {
    expect(OFFICIAL_SKILLS.map((o) => `${o.slug}:${scanSkillForPublication(o.content).light}`)).toEqual(OFFICIAL_SKILLS.map((o) => `${o.slug}:green`));
  });

  it("lists them under @consyrium with version and hash, adoptable and reportable", async () => {
    const official = (await listPublicSkills(handle.db)).filter((s) => s.handle === "consyrium");
    expect(official.map((s) => s.slug)).toEqual(OFFICIAL_SKILLS.map((o) => o.slug));
    const one = await getPublicSkill(handle.db, "@consyrium", OFFICIAL_SKILLS[0]!.slug);
    expect(one).toMatchObject({ version: OFFICIAL_SKILLS[0]!.version, license: "CC-BY-4.0" });
    expect(one?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const copy = await adoptPublicSkill(handle.db, bob, "consyrium", OFFICIAL_SKILLS[0]!.slug);
    expect((await getPublicSkill(handle.db, "consyrium", OFFICIAL_SKILLS[0]!.slug))?.uses).toBe(1);
    await archiveSkill(handle.db, bob, (await adoptPublicSkill(handle.db, bob, "consyrium", OFFICIAL_SKILLS[2]!.slug)).id);
    expect((await getPublicSkill(handle.db, "consyrium", OFFICIAL_SKILLS[2]!.slug))?.uses).toBe(0); // archived copies do not count
    expect((await listSkills(handle.db, bob)).find((s) => s.id === copy.id)?.forkedFrom?.name).toBe(`@consyrium/${OFFICIAL_SKILLS[0]!.slug}`);
    const before = await countNewFeedback(handle.db, admin);
    await reportPublicSkill(handle.db, bob, { handle: "consyrium", slug: OFFICIAL_SKILLS[0]!.slug, reason: "misleading", note: "Outdated figure." });
    expect(await countNewFeedback(handle.db, admin)).toBe(before + 1);
    await expect(reportPublicSkill(handle.db, bob, { handle: "consyrium", slug: OFFICIAL_SKILLS[0]!.slug, reason: "spam" })).rejects.toThrow(
      /already reported/,
    );
    expect(await countNewFeedback(handle.db, admin)).toBe(before + 1);
  });

  it("a platform admin hides and shows an official skill without a deploy", async () => {
    const slug = OFFICIAL_SKILLS[1]!.slug;
    await expect(setOfficialSkillHidden(handle.db, { userId: "x", email: "x" } as PlatformAdminContext, slug, true)).rejects.toThrow(/Not found/);
    await setOfficialSkillHidden(handle.db, admin, slug, true);
    expect(await getPublicSkill(handle.db, "consyrium", slug)).toBeNull();
    expect((await listOfficialSkillsForAdmin(handle.db, admin)).find((o) => o.slug === slug)).toMatchObject({ hidden: true, scanLight: "green" });
    await setOfficialSkillHidden(handle.db, admin, slug, false);
    expect(await getPublicSkill(handle.db, "consyrium", slug)).not.toBeNull();
  });
});

describe("hub kinds (#368: expert profiles as their own type)", () => {
  it("keeps profile hub entries out of the skill list and filters the catalog by kind", async () => {
    // A profile hub entry (as the role-profile flow will create it) never shows up among the workspace's skills.
    await handle.db.insert(skill).values({
      id: "skl_profile_entry",
      organizationId: alice.organizationId,
      ownerUserId: "alice",
      name: "Profile entry",
      kind: "role_profile",
      sourceId: "rpf_1",
    });
    expect((await listSkills(handle.db, alice)).some((s) => s.id === "skl_profile_entry")).toBe(false);
    expect(await listPublicSkills(handle.db, { kind: "role_profile" })).toEqual([]); // no official skills under "profiles"
    expect((await listPublicSkills(handle.db, { kind: "skill" })).every((s) => s.kind === "skill")).toBe(true);
    expect((await listPublicSkills(handle.db, { kind: "nonsense" })).length).toBeGreaterThan(0); // unknown kind = no filter
  });

  it("validates profile drafts with the profile adapter (owner decision 08.11.26)", async () => {
    await expect(saveHubDraft(handle.db, alice, { kind: "role_profile", sourceId: "rpf_2", name: "x", content: {} })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("expert profiles in the hub – live check 09.11.2026", () => {
  it("counts profile adoptions from other workspaces and names the origin of the copy", async () => {
    const content = {
      schemaVersion: 1,
      role: "cost_analyst",
      name: "Hub cost profile",
      coreQuestion: "Which recurring costs arise per month, and are they backed?",
      lenses: ["Separate one-time and recurring costs", "Ranges above a limit count as not confirmed", "Name excluded costs per figure"],
      notSuitableFor: "Legal assessments",
      sources: [{ title: "Own experience", url: null, status: "own_statement", checkedAt: null, note: null }],
    };
    const profile = await createRoleProfile(handle.db, alice, { content });
    const draft = await saveHubDraft(handle.db, alice, { kind: "role_profile", sourceId: profile.id, name: "Hub cost profile", content });
    await submitSkillForPublication(handle.db, alice, draft.skillId, { slug: "hub-cost-profile", license: "CC-BY-4.0", changelog: "First version." }, now);
    await handle.db.update(skillVersion).set({ reviewStatus: "published", publishedAt: now }).where(eq(skillVersion.skillId, draft.skillId));
    await handle.db.update(skill).set({ publicVersion: 1 }).where(eq(skill.id, draft.skillId));

    expect((await getPublicSkill(handle.db, "alice", "hub-cost-profile"))?.uses).toBe(0);
    const copy = await adoptPublicSkill(handle.db, bob, "alice", "hub-cost-profile");
    expect((await getPublicSkill(handle.db, "alice", "hub-cost-profile"))?.uses).toBe(1);
    await adoptPublicSkill(handle.db, alice, "alice", "hub-cost-profile"); // the author's own workspace does not count
    expect((await getPublicSkill(handle.db, "alice", "hub-cost-profile"))?.uses).toBe(1);
    const mine = (await listRoleProfiles(handle.db, bob)).find((p) => p.id === copy.id);
    expect(mine?.forkedFromName).toBe("@alice/hub-cost-profile");
  });
});

describe("catalog pages (11.11.26: the older half of 100 team skills fell off the single page)", () => {
  it("shows every listed skill across pages, official skills only on page 1", async () => {
    for (let i = 0; i < CATALOG_PAGE_SIZE + 3; i++) await published(`Paging skill ${String(i).padStart(3, "0")}`);
    const all = (await listPublicSkills(handle.db, { q: "Paging skill", limit: 100 })).length;
    expect(all).toBe(CATALOG_PAGE_SIZE + 3);
    const first = await listPublicSkillsPage(handle.db);
    const community = first.skills.filter((s) => s.handle !== "consyrium");
    expect(first.skills.some((s) => s.handle === "consyrium")).toBe(true);
    expect(community).toHaveLength(CATALOG_PAGE_SIZE);
    expect(first).toMatchObject({ page: 1, hasMore: true });
    const seen = new Set(community.map((s) => s.slug));
    let page = 1;
    let more = first.hasMore;
    while (more) {
      const next = await listPublicSkillsPage(handle.db, { page: ++page });
      expect(next.skills.some((s) => s.handle === "consyrium")).toBe(false);
      for (const s of next.skills) {
        expect(seen.has(s.slug), s.slug).toBe(false);
        seen.add(s.slug);
      }
      more = next.hasMore;
    }
    const paging = [...seen].filter((slug) => slug.startsWith("paging-skill-"));
    expect(paging).toHaveLength(CATALOG_PAGE_SIZE + 3);
    // A search keeps its filter on every page; an out-of-range or invalid page is handled.
    expect((await listPublicSkillsPage(handle.db, { q: "Paging skill", page: 2 })).skills).toHaveLength(3);
    expect((await listPublicSkillsPage(handle.db, { page: 999 })).skills).toEqual([]);
    expect((await listPublicSkillsPage(handle.db, { page: Number("abc") })).page).toBe(1);
  });
});
