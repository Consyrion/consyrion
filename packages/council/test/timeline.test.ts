/** #12 – run timeline with a resumable cursor: ordered, gap-free, no duplicates, late commits not lost, no text. */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  newId,
  resolveActor,
  schema,
  setSubscriptionPlan,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, runSession, sessionTimeline, sessionUsageSnapshot, TIMELINE_SETTLE_MS, type SessionInput } from "../src";
import { ScriptedAdapter } from "./scripted-adapter";
import { confirmProposedRequirements } from "./confirm-requirements";

let handle: DatabaseHandle;
let actor: ActorContext;
let sessionId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
const later = () => new Date(Date.now() + 60_000);

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  const projectId = (
    await createProject(handle.db, actor, {
      name: "Clinic",
      type: "architecture",
      brief: { idea: "Design a scheduling SaaS for 120 clinics.", requirements: "Health data must stay in Germany." },
    })
  ).id;
  const credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, actor, projectId);
  const scores = (t: string) => (t === "Monolith" ? 9 : 6);
  const adapters = new Map(
    Object.entries({ m1: { title: "Monolith", score: scores }, m2: { title: "Microservices", score: scores }, m3: { title: "Serverless", score: scores } }).map(
      ([m, s]) => [m, new ScriptedAdapter(s)],
    ),
  );
  const participants = [...adapters.keys()].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
  sessionId = (await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true })).id;
  await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, sessionId);
});

afterEach(async () => {
  await handle.close();
});

describe("#12 session timeline", () => {
  it("lists the run in order with unique ids, every kind, and no text", async () => {
    const all = await sessionTimeline(handle.db, actor, sessionId, { limit: 500, now: later() });
    const kinds = new Set(all.events.map((e) => e.kind));
    for (const k of ["message", "call", "stage", "revision", "score", "vote", "verdict"]) expect(kinds.has(k as never), k).toBe(true);
    expect(new Set(all.events.map((e) => e.id)).size).toBe(all.events.length);
    const times = all.events.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(all.complete).toBe(true);
    expect(JSON.stringify(all)).not.toMatch(/Monolith|Microservices|Serverless|scheduling/);
    const stage = all.events.filter((e) => e.kind === "stage").map((e) => e.data.event);
    expect(stage).toEqual(expect.arrayContaining(["started", "completed"]));
  });

  it("pages with the cursor without gaps or duplicates", async () => {
    const full = (await sessionTimeline(handle.db, actor, sessionId, { limit: 500, now: later() })).events.map((e) => e.id);
    const paged: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 100; i++) {
      const page = await sessionTimeline(handle.db, actor, sessionId, { after, limit: 7, now: later() });
      paged.push(...page.events.map((e) => e.id));
      if (!page.events.length) break;
      after = page.nextCursor;
    }
    expect(paged).toEqual(full);
  });

  it("holds back recent events, so a write that commits late with an older timestamp is not lost", async () => {
    const now = new Date();
    const first = await sessionTimeline(handle.db, actor, sessionId, { limit: 500, now });
    // A model call whose transaction started before the read but committed after it (timestamp inside the window).
    const lateAt = new Date(now.getTime() - TIMELINE_SETTLE_MS / 2);
    const lateId = newId("use");
    await handle.db.insert(schema.usageRecord).values({
      id: lateId,
      organizationId: actor.organizationId,
      sessionId,
      provider: "anthropic",
      modelId: "m1",
      phase: "final_verdict",
      outcome: "ok",
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 1,
      createdAt: lateAt,
    } as never);
    const next = await sessionTimeline(handle.db, actor, sessionId, {
      after: first.nextCursor,
      limit: 500,
      now: new Date(now.getTime() + TIMELINE_SETTLE_MS + 1000),
    });
    expect(next.events.map((e) => e.id)).toContain(`call:${lateId}`);
  });

  it("is workspace-scoped and refuses a malformed cursor", async () => {
    await handle.db.insert(schema.user).values({ id: "u2", name: "Other", email: "x@example.test" });
    const other = await resolveActor(handle.db, "u2", (await ensurePersonalOrganization(handle.db, "u2", "Other")).id);
    await expect(sessionTimeline(handle.db, other, sessionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sessionTimeline(handle.db, actor, sessionId, { after: "bm9wZQ" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("sessionUsageSnapshot (#12)", () => {
  it("sums calls, failures and tokens, reports the phase and the budget share, and keeps phaseless calls apart", () => {
    const snapshot = sessionUsageSnapshot({
      session: { status: "running", currentPhase: "open_council", tokensUsed: 2_500, tokenBudget: 10_000 },
      usage: [
        { participantId: "p1", phase: "independent_thinking", outcome: "ok", calls: 2, inputTokens: 800, outputTokens: 400, cachedInputTokens: 100 },
        { participantId: "p2", phase: "independent_thinking", outcome: "error", calls: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        { participantId: "p1", phase: null, outcome: "ok", calls: 1, inputTokens: 300, outputTokens: 100, cachedInputTokens: 0 },
      ],
    } as never);
    expect(snapshot).toEqual({
      status: "running",
      phase: "open_council",
      calls: 4,
      failedCalls: 1,
      inputTokens: 1_100,
      outputTokens: 500,
      cachedInputTokens: 100,
      tokensUsed: 2_500,
      tokenBudget: 10_000,
      share: 0.25,
      phaseless: { calls: 1, tokens: 400 },
    });
  });
});
