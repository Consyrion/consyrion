import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { membership, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import {
  countNewFeedback,
  createFeedback,
  deleteFeedback,
  getFeedbackForAdmin,
  listFeedbackForAdmin,
  listMyFeedback,
  replyToFeedback,
  resolvePlatformAdmin,
  setFeedbackState,
  type PlatformAdminContext,
} from "./feedback";
import { createOrganization, ensurePersonalOrganization } from "./organizations";

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
