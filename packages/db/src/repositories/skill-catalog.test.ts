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
  listPublicSkills,
  reportPublicSkill,
  resolveSkillReport,
  setOfficialSkillHidden,
} from "./skill-catalog";
import { countNewFeedback } from "./feedback";
import { OFFICIAL_SKILLS, scanSkillForPublication } from "@consyrion/core";
import { claimPublisherHandle, submitSkillForPublication } from "./skill-hub";
import { createSkill, getSkillForUse, listSkills } from "./skills";

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
  bob = await resolveActor(handle.db, "bob", (await ensurePersonalOrganization(handle.db, "bob", "Bob")).id);
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
    expect((await listPublicSkills(handle.db, { category: "cost" })).map((s) => s.handle)).toEqual(["consyrion"]);
    expect(await listPublicSkills(handle.db, { q: "%" })).toEqual([]);
  });

  it("adopts a public skill as the caller's own private copy, and other workspaces still cannot read the original", async () => {
    const copy = await adoptPublicSkill(handle.db, bob, "alice", "public-hosting-review");
    const own = (await listSkills(handle.db, bob)).find((s) => s.id === copy.id);
    expect(own).toMatchObject({ visibility: "private", editable: true, forkedFrom: { name: "@alice/public-hosting-review", version: 1 } });
    expect((await getPublicSkill(handle.db, "alice", "public-hosting-review"))?.uses).toBe(1);
    await adoptPublicSkill(handle.db, bob, "alice", "public-hosting-review"); // same workspace again
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

  it("lists them under @consyrion with version and hash, adoptable and reportable", async () => {
    const official = (await listPublicSkills(handle.db)).filter((s) => s.handle === "consyrion");
    expect(official.map((s) => s.slug)).toEqual(OFFICIAL_SKILLS.map((o) => o.slug));
    const one = await getPublicSkill(handle.db, "@consyrion", OFFICIAL_SKILLS[0]!.slug);
    expect(one).toMatchObject({ version: OFFICIAL_SKILLS[0]!.version, license: "CC-BY-4.0" });
    expect(one?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const copy = await adoptPublicSkill(handle.db, bob, "consyrion", OFFICIAL_SKILLS[0]!.slug);
    expect((await listSkills(handle.db, bob)).find((s) => s.id === copy.id)?.forkedFrom?.name).toBe(`@consyrion/${OFFICIAL_SKILLS[0]!.slug}`);
    const before = await countNewFeedback(handle.db, admin);
    await reportPublicSkill(handle.db, bob, { handle: "consyrion", slug: OFFICIAL_SKILLS[0]!.slug, reason: "misleading", note: "Outdated figure." });
    expect(await countNewFeedback(handle.db, admin)).toBe(before + 1);
  });

  it("a platform admin hides and shows an official skill without a deploy", async () => {
    const slug = OFFICIAL_SKILLS[1]!.slug;
    await expect(setOfficialSkillHidden(handle.db, { userId: "x", email: "x" } as PlatformAdminContext, slug, true)).rejects.toThrow(/Not found/);
    await setOfficialSkillHidden(handle.db, admin, slug, true);
    expect(await getPublicSkill(handle.db, "consyrion", slug)).toBeNull();
    expect((await listOfficialSkillsForAdmin(handle.db, admin)).find((o) => o.slug === slug)).toMatchObject({ hidden: true, scanLight: "green" });
    await setOfficialSkillHidden(handle.db, admin, slug, false);
    expect(await getPublicSkill(handle.db, "consyrion", slug)).not.toBeNull();
  });
});
