/**
 * Release test against a real PostgreSQL (#181 review): concurrency that PGlite (one connection) cannot show.
 * Skipped unless RELEASE_TEST_DATABASE_URL points to a throwaway database – it drops and recreates the public schema.
 *   RELEASE_TEST_DATABASE_URL=postgres://user@127.0.0.1:55432/release_test pnpm --filter @consyrion/council exec vitest run test/release-postgres.test.ts
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import {
  addDocument,
  createCredential,
  deleteDocument,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  lockProjectSources,
  resolveActor,
  schema,
  setSubscriptionPlan,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession, runSession, type SessionInput } from "../src";
import { ScriptedAdapter } from "./scripted-adapter";
import { confirmProposedRequirements } from "./confirm-requirements";

const url = process.env.RELEASE_TEST_DATABASE_URL;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
let handle: DatabaseHandle;
let actor: ActorContext;
let credentialId: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const scores = (t: string) => (t === "Monolith" ? 9 : 6);

describe.skipIf(!url)("release test on PostgreSQL (#181)", () => {
  beforeAll(async () => {
    handle = createDatabase(url);
    expect(handle.kind).toBe("postgres");
  });
  afterAll(async () => {
    await handle?.close();
  });
  beforeEach(async () => {
    await handle.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await handle.migrate();
    await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
    const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
    actor = await resolveActor(handle.db, "u1", org.id);
    await setSubscriptionPlan(handle.db, "u1", org.id, "business");
    credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  });

  async function project() {
    const id = (
      await createProject(handle.db, actor, {
        name: "Clinic SaaS",
        type: "architecture",
        brief: {
          idea: "Design a scheduling SaaS for 120 clinics.",
          requirements: "Health data must stay in Germany. Running costs must not exceed 300 EUR per month.",
        },
      })
    ).id;
    await confirmProposedRequirements(handle.db, actor, id);
    return id;
  }

  function council() {
    const adapters = new Map(
      Object.entries({
        m1: { title: "Monolith", score: scores },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores },
      }).map(([model, script]) => [model, new ScriptedAdapter(script)]),
    );
    return {
      adapters,
      deps: { db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 },
      participants: [...adapters.keys()].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"],
    };
  }

  it("a document deletion waits for a transaction that holds the project lock (serialisation, not just a re-read)", async () => {
    // Inserts into tables that reference the project already wait for FOR UPDATE through their foreign-key check; a
    // DELETE does not – only lockProjectSources makes it wait. This is the case the lock is needed for.
    const projectId = await project();
    const doc = await addDocument(handle.db, actor, projectId, {
      name: "notes.md",
      mimeType: "text/markdown",
      bytes: new TextEncoder().encode("Context only."),
    });
    let committedAt = 0;
    const holder = handle.db.transaction(async (tx) => {
      await lockProjectSources(tx, projectId);
      await sleep(600);
      committedAt = Date.now();
    });
    await sleep(100);
    const started = Date.now();
    await deleteDocument(handle.db, actor, projectId, doc.id);
    const finished = Date.now();
    await holder;
    expect(finished).toBeGreaterThanOrEqual(committedAt);
    expect(finished - started).toBeGreaterThanOrEqual(400);
  });

  it("concurrent start and document deletion: no council is ever stored with a document that no longer exists", async () => {
    const projectId = await project();
    const c = council();
    let started = 0;
    let refused = 0;
    for (let round = 0; round < 30; round++) {
      const doc = await addDocument(handle.db, actor, projectId, {
        name: `spec-${round}.md`,
        mimeType: "text/markdown",
        bytes: new TextEncoder().encode(`The system must keep audit logs for ${round + 1} years.`),
      });
      await confirmProposedRequirements(handle.db, actor, projectId);
      const [start, removal] = await Promise.allSettled([
        createSession(handle.db, actor, projectId, { mode: "independent_expert", participants: c.participants, confirmBudget: true }),
        // Staggered so that both orders and real overlaps with the start's transaction occur.
        sleep(round * 6).then(() => deleteDocument(handle.db, actor, projectId, doc.id)),
      ]);
      if (start.status === "fulfilled") started++;
      else {
        refused++;
        if (refused === 1) console.info(`[release] first refusal: ${(start.reason as Error).message}`);
      }
      // Either order is fine – but never both "started with the document" and "document deleted".
      if (start.status === "fulfilled" && removal.status === "fulfilled") {
        const [session] = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.id, start.value.id));
        expect(session!.documentIds).not.toContain(doc.id);
      }
      // Clean up for the next round: finish the council and remove a document that survived.
      await handle.db.update(schema.councilSession).set({ status: "cancelled" }).where(eq(schema.councilSession.projectId, projectId));
      if (removal.status === "rejected") await deleteDocument(handle.db, actor, projectId, doc.id);
    }
    const sessions = await handle.db.select().from(schema.councilSession).where(eq(schema.councilSession.projectId, projectId));
    for (const s of sessions) {
      const [list] = await handle.db.select().from(schema.requirementList).where(eq(schema.requirementList.id, s.requirementListId!));
      expect(list!.briefId).toBe(s.briefId);
    }
    // Both orders must actually have happened, otherwise this test proves nothing.
    expect(started).toBeGreaterThan(0);
    console.info(`[release] start vs. deletion: ${started} started, ${refused} refused`);
  });

  it("two workers on the same Final Verdict store one evaluation per evaluator – no mixed raw checks", async () => {
    const projectId = await project();
    const c = council();
    const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants: c.participants, confirmBudget: true });
    await Promise.allSettled([runSession(c.deps, id), runSession(c.deps, id)]);
    const votes = await handle.db.select().from(schema.vote).where(eq(schema.vote.sessionId, id));
    const evaluators = new Set(votes.map((v) => v.evaluatorParticipantId));
    expect(evaluators.size).toBe(votes.length);
    const [round] = await handle.db.select().from(schema.evaluationRound).where(eq(schema.evaluationRound.sessionId, id));
    expect(await handle.db.select().from(schema.evaluationRound).where(eq(schema.evaluationRound.sessionId, id))).toHaveLength(1);
    const checks = await handle.db.select().from(schema.requirementCheck).where(eq(schema.requirementCheck.sessionId, id));
    for (const evaluator of evaluators) {
      const expected = round!.proposals.filter((p) => p.expectedEvaluatorIds.includes(evaluator)).length * round!.requirementIds.length;
      expect(checks.filter((r) => r.evaluatorParticipantId === evaluator)).toHaveLength(expected);
    }
  });
});
