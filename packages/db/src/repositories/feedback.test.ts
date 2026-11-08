import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { membership, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import {
  countNewFeedback,
  countUnreadFeedbackReplies,
  createFeedback,
  deleteFeedback,
  getFeedbackForAdmin,
  listFeedbackForAdmin,
  listMyFeedback,
  markFeedbackRepliesSeen,
  replyToFeedback,
  resolvePlatformAdmin,
  setFeedbackState,
  type PlatformAdminContext,
} from "./feedback";
import { createOrganization, ensurePersonalOrganization } from "./organizations";
import { exportOrganization } from "./privacy";
import { createProject } from "./projects";
import { setSubscriptionPlan } from "./saas";

let handle: DatabaseHandle;
let alice: ActorContext;
let carol: ActorContext; // admin of Alice's workspace – still no access to Alice's reports
let viewer: ActorContext;
let bob: ActorContext; // other workspace
let admin: PlatformAdminContext;
const ADMINS = ["Root@Example.test"];

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob", "carol", "vic", "root"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  const orgA = await ensurePersonalOrganization(handle.db, "alice", "Alice");
  const orgB = await createOrganization(handle.db, "bob", { name: "Bob Inc" });
  await handle.db.insert(membership).values([
    { id: "mem_carol", organizationId: orgA.id, userId: "carol", role: "admin" },
    { id: "mem_vic", organizationId: orgA.id, userId: "vic", role: "viewer" },
  ]);
  alice = await resolveActor(handle.db, "alice", orgA.id);
  carol = await resolveActor(handle.db, "carol", orgA.id);
  viewer = await resolveActor(handle.db, "vic", orgA.id);
  bob = await resolveActor(handle.db, "bob", orgB.id);
  admin = await resolvePlatformAdmin(handle.db, "root", ADMINS);
});

afterAll(async () => {
  await handle.close();
});

describe("feedback inbox (#295)", () => {
  it("stores a user's report with the account e-mail and only the page path; the author sees only their own", async () => {
    const report = await createFeedback(
      handle.db,
      { kind: "user", actor: alice },
      {
        kind: "bug",
        subject: "  Verdict   tab is empty ",
        text: "Steps: open a session…",
        page: "/sessions/ses_1?token=secret#x",
        locale: "de",
        agent: "Safari",
        appVersion: "abc123",
      },
    );
    expect(report).toMatchObject({
      userId: "alice",
      email: "alice@example.test",
      subject: "Verdict tab is empty",
      page: "/sessions/ses_1",
      state: "new",
      organizationId: alice.organizationId,
    });
    await createFeedback(handle.db, { kind: "user", actor: viewer }, { kind: "feature", subject: "Dark PDF", text: "Please" });

    expect((await listMyFeedback(handle.db, alice)).map((r) => r.id)).toEqual([report.id]);
    // Neither a workspace admin nor anybody from another workspace sees Alice's report.
    expect(await listMyFeedback(handle.db, carol)).toHaveLength(0);
    expect(await listMyFeedback(handle.db, bob)).toHaveLength(0);
    expect(await listMyFeedback(handle.db, viewer)).toHaveLength(1);
  });

  it("accepts visitors only with a valid e-mail and validates kind and lengths", async () => {
    const visit = await createFeedback(
      handle.db,
      { kind: "visitor", email: " Guest@Example.test " },
      { kind: "contact", subject: "Pricing", text: "Self-hosting?" },
    );
    expect(visit).toMatchObject({ userId: null, organizationId: null, email: "guest@example.test" });
    await expect(createFeedback(handle.db, { kind: "visitor", email: "nope" }, { kind: "contact", subject: "x", text: "y" })).rejects.toThrow(/highlighted/);
    await expect(createFeedback(handle.db, { kind: "user", actor: alice }, { kind: "spam" as "bug", subject: "x", text: "y" })).rejects.toThrow(/highlighted/);
    await expect(createFeedback(handle.db, { kind: "user", actor: alice }, { kind: "bug", subject: "x".repeat(121), text: "y" })).rejects.toThrow(
      /highlighted/,
    );
    await expect(createFeedback(handle.db, { kind: "user", actor: alice }, { kind: "bug", subject: "x", text: "y".repeat(4001) })).rejects.toThrow(
      /highlighted/,
    );
    await expect(createFeedback(handle.db, { kind: "user", actor: alice }, { kind: "bug", subject: "x", text: "   " })).rejects.toThrow(/highlighted/);
  });

  it("lets only platform admins read, answer, close and delete – the author sees the reply", async () => {
    await expect(resolvePlatformAdmin(handle.db, "alice", ADMINS)).rejects.toThrow(/not found/i);
    await expect(resolvePlatformAdmin(handle.db, "ghost", ADMINS)).rejects.toThrow(/not found/i);
    await expect(resolvePlatformAdmin(handle.db, "root", [])).rejects.toThrow(/not found/i);
    // With e-mail verification on, an unverified admin address is not enough (registering an unclaimed address).
    await expect(resolvePlatformAdmin(handle.db, "root", ADMINS, { requireVerifiedEmail: true })).rejects.toThrow(/not found/i);
    await handle.db.update(user).set({ emailVerified: true }).where(eq(user.id, "root"));
    await expect(resolvePlatformAdmin(handle.db, "root", ADMINS, { requireVerifiedEmail: true })).resolves.toMatchObject({ userId: "root" });
    await handle.db.update(user).set({ emailVerified: false }).where(eq(user.id, "root"));
    // A forged context (cast) is rejected as well.
    const forged = { userId: "alice", email: "root@example.test" } as PlatformAdminContext;
    await expect(listFeedbackForAdmin(handle.db, forged)).rejects.toThrow(/not found/i);
    await expect(countNewFeedback(handle.db, forged)).rejects.toThrow(/not found/i);

    const all = await listFeedbackForAdmin(handle.db, admin);
    expect(all).toHaveLength(3);
    expect(await countNewFeedback(handle.db, admin)).toBe(3);
    expect((await listFeedbackForAdmin(handle.db, admin, { kind: "contact" })).map((r) => r.email)).toEqual(["guest@example.test"]);

    const [mine] = await listMyFeedback(handle.db, alice);
    await expect(replyToFeedback(handle.db, forged, mine!.id, "hi")).rejects.toThrow(/not found/i);
    await expect(setFeedbackState(handle.db, forged, mine!.id, "done")).rejects.toThrow(/not found/i);
    await expect(deleteFeedback(handle.db, forged, mine!.id)).rejects.toThrow(/not found/i);
    await expect(getFeedbackForAdmin(handle.db, forged, mine!.id)).rejects.toThrow(/not found/i);

    await replyToFeedback(handle.db, admin, mine!.id, "Fixed in the next release – thanks!");
    expect((await getFeedbackForAdmin(handle.db, admin, mine!.id)).feedback.state).toBe("in_progress");
    expect(await countNewFeedback(handle.db, admin)).toBe(2);
    const [seen] = await listMyFeedback(handle.db, alice);
    expect(seen!.replies.map((r) => r.text)).toEqual(["Fixed in the next release – thanks!"]);

    const done = await setFeedbackState(handle.db, admin, mine!.id, "done");
    expect(done.doneAt).toBeInstanceOf(Date);
    expect((await listFeedbackForAdmin(handle.db, admin, { state: "done" })).map((r) => r.id)).toEqual([mine!.id]);
    await expect(setFeedbackState(handle.db, admin, mine!.id, "archived" as "done")).rejects.toThrow(/highlighted/);

    await deleteFeedback(handle.db, admin, mine!.id);
    await expect(getFeedbackForAdmin(handle.db, admin, mine!.id)).rejects.toThrow(/not found/i);
    expect(await listMyFeedback(handle.db, alice)).toHaveLength(0);
  });
});

describe("feedback stage 2 (#295): screenshot and data export", () => {
  // Smallest valid PNG header (signature + IHDR start) – enough for the signature check.
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
  const base = { kind: "bug" as const, subject: "Shot", text: "See screenshot" };

  it("stores a checked screenshot as a data URL and rejects fakes, other formats and oversize images", async () => {
    const report = await createFeedback(handle.db, { kind: "user", actor: bob }, { ...base, screenshot: PNG.toString("base64") });
    expect(report.screenshot).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect((await getFeedbackForAdmin(handle.db, admin, report.id)).feedback.screenshot).toMatch(/^data:image\/png;base64,/);

    const fake = Buffer.from("<svg onload=alert(1)>…padding…").toString("base64");
    await expect(createFeedback(handle.db, { kind: "user", actor: bob }, { ...base, screenshot: fake })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createFeedback(handle.db, { kind: "user", actor: bob }, { ...base, screenshot: "not base64 !" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const big = Buffer.concat([PNG, Buffer.alloc(3_000_001)]).toString("base64");
    await expect(createFeedback(handle.db, { kind: "user", actor: bob }, { ...base, screenshot: big })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await createFeedback(handle.db, { kind: "visitor", email: "g@example.test" }, base)).screenshot).toBeNull();
  });

  it("puts only the exporting user's own reports and replies into the workspace export", async () => {
    const own = await createFeedback(handle.db, { kind: "user", actor: alice }, { ...base, subject: "Alice export" });
    await replyToFeedback(handle.db, admin, own.id, "Answer for Alice");
    await createFeedback(handle.db, { kind: "user", actor: carol }, { ...base, subject: "Carol private" });
    const data = await exportOrganization(handle.db, alice);
    expect(data.feedback.map((f) => f.subject)).toEqual(["Alice export"]);
    expect(data.feedbackReplies.map((r) => r.text)).toEqual(["Answer for Alice"]);
    expect(JSON.stringify(data.feedbackReplies)).not.toContain("adminId");
  });
});

describe("feedback stage 3: page context with consent, unread answers (#295)", () => {
  const base = { kind: "bug" as const, subject: "Broken chart", text: "The chart is empty." };

  it("keeps only project/council ids of the author's own workspace", async () => {
    await setSubscriptionPlan(handle.db, "root", alice.organizationId, "business");
    await setSubscriptionPlan(handle.db, "root", bob.organizationId, "business");
    const own = await createProject(handle.db, alice, { name: "Alice project", type: "idea", brief: { idea: "Build a small CRM for a bakery.", goal: "" } });
    const foreign = await createProject(handle.db, bob, { name: "Bob project", type: "idea", brief: { idea: "Build a small CRM for a garage.", goal: "" } });
    const ok = await createFeedback(handle.db, { kind: "user", actor: alice }, { ...base, context: { projectId: own.id } });
    expect(ok.context).toEqual({ projectId: own.id });
    const sneaky = await createFeedback(handle.db, { kind: "user", actor: alice }, { ...base, context: { projectId: foreign.id, sessionId: "ses_made_up" } });
    expect(sneaky.context).toBeNull();
    // Visitors never attach a context.
    const visitor = await createFeedback(handle.db, { kind: "visitor", email: "x@example.test" }, { ...base, context: { projectId: own.id } });
    expect(visitor.context).toBeNull();
  });

  it("counts answers the author has not seen yet and clears them when the author looks", async () => {
    // Earlier tests in this file already answered some of Carol's and Alice's reports: start from what they have.
    await markFeedbackRepliesSeen(handle.db, carol);
    const aliceBefore = await countUnreadFeedbackReplies(handle.db, alice);
    const report = await createFeedback(handle.db, { kind: "user", actor: carol }, base);
    expect(await countUnreadFeedbackReplies(handle.db, carol)).toBe(0);
    await replyToFeedback(handle.db, admin, report.id, "Fixed, thanks!");
    expect(await countUnreadFeedbackReplies(handle.db, carol)).toBe(1);
    // Nobody else sees it as theirs.
    expect(await countUnreadFeedbackReplies(handle.db, alice)).toBe(aliceBefore);
    const mine = await listMyFeedback(handle.db, carol);
    expect(mine.find((r) => r.id === report.id)!.replies[0]).toMatchObject({ text: "Fixed, thanks!", unread: true });
    await markFeedbackRepliesSeen(handle.db, carol, new Date(Date.now() + 1000));
    expect(await countUnreadFeedbackReplies(handle.db, carol)).toBe(0);
    expect((await listMyFeedback(handle.db, carol)).find((r) => r.id === report.id)!.replies[0]!.unread).toBe(false);
  });
});
