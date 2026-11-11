/**
 * Load and race tests of the assistant (#510): parallel questions, double clicks and aborts against the real route
 * handlers on PGlite, with a scripted provider (no real key, no network). The provider waits a little before it answers,
 * so parallel requests really overlap between the limit check and the usage booking.
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv, type Entitlements } from "@consyrium/core";
import {
  addAssistantMessage,
  createAssistantChat,
  createCredential,
  createDatabase,
  ensurePersonalOrganization,
  getPlanCatalog,
  resolveActor,
  schema,
  setAssistantPreference,
  setSubscriptionPlan,
  updatePlanDefinition,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
let actor: ActorContext;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/actor", () => ({ requireActor: async () => actor }));
vi.mock("@/lib/server/keyring", () => ({ getKeyring: () => keyring }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

/** Scripted provider: answers after `delay` ms with fixed usage; a check request gets a verdict. */
const USAGE = { inputTokens: 100, outputTokens: 50 };
let delay = 40;
vi.mock("@consyrium/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@consyrium/ai")>();
  return {
    ...actual,
    createAdapter: () => ({
      generate: async (request: { jsonSchema?: { name: string }; signal?: AbortSignal; model: string }) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new actual.ProviderError("anthropic", "cancelled", "aborted"));
          });
        });
        const json = request.jsonSchema?.name === "cross_check" ? { verdict: "confirmed", reason: "ok" } : { tool_calls: [], answer: "Antwort", actions: [] };
        return { provider: "anthropic", model: request.model, text: JSON.stringify(json), json, stopReason: "end", usage: USAGE };
      },
    }),
  };
});

const { POST: ask } = await import("./chats/[id]/messages/route");
const { estimateAnswerTokens } = await import("@/lib/server/assistant");
const { POST: review } = await import("./chats/[id]/messages/[messageId]/review/route");
const { POST: check } = await import("./chats/[id]/messages/[messageId]/check/route");
const { POST: council } = await import("./chats/[id]/council/route");

let credentialId: string;
let users = 0;
/** A fresh user with an own workspace (own rate-limit window, own plan count). */
async function freshActor(): Promise<ActorContext> {
  const id = `u_load_${++users}`;
  await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  const org = await ensurePersonalOrganization(handle.db, id, id);
  const ctx = await resolveActor(handle.db, id, org.id);
  credentialId = (await createCredential(handle.db, ctx, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  return ctx;
}
const json = (body: unknown, signal?: AbortSignal) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) as never });
const usage = async (ctx: ActorContext, kind?: string) =>
  (await handle.db.select().from(schema.assistantUsage)).filter((r) => r.userId === ctx.userId && (!kind || r.kind === kind));

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "admin", name: "admin", email: "admin@example.test" });
  const starter = (await getPlanCatalog(handle.db)).find((p) => p.key === "starter")!;
  await updatePlanDefinition(handle.db, "admin", "starter", {
    name: starter.name,
    entitlements: { ...(starter.entitlements as unknown as Entitlements), maxAssistantQuestionsPerDay: 5 },
    priceLabel: starter.priceLabel,
    stripePriceId: starter.stripePriceId,
    active: starter.active,
  });
});

afterAll(async () => {
  await handle.close();
});

describe("assistant under load (#510)", () => {
  it("1: 20 parallel questions with a plan limit of 5 per day answer at most 5 times and book each answer once", async () => {
    actor = await freshActor();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ask(json({ content: `Frage ${i}`, credentialId, modelId: "claude-test" }), params({ id: "new" }))),
    );
    const ok = responses.filter((r) => r.status === 200).length;
    const answers = await usage(actor, "answer");
    expect(answers.length).toBe(ok);
    expect(ok).toBeLessThanOrEqual(5);
    expect(responses.filter((r) => r.status !== 200).every((r) => [409, 422, 429, 403].includes(r.status))).toBe(true);
  });

  it("1b: 10 parallel council-chat turns (2 models each) with a plan limit of 5 count each question once and stop at 5", async () => {
    actor = await freshActor();
    const participants = [
      { credentialId, modelId: "model-a" },
      { credentialId, modelId: "model-b" },
    ];
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => council(json({ content: `Frage ${i}`, participants }), params({ id: "new" }))));
    const ok = responses.filter((r) => r.status === 201).length;
    expect(ok).toBeLessThanOrEqual(5);
    expect(await usage(actor, "answer")).toHaveLength(ok);
    expect(await usage(actor, "council_answer")).toHaveLength(ok);
  });

  it("2: parallel questions cannot pass the personal token limit – the estimate is reserved before the call (#519)", async () => {
    actor = await freshActor();
    // Without a plan limit (business), so only the personal token limit is measured.
    await setSubscriptionPlan(handle.db, "admin", actor.organizationId, "business");
    // Room for three reserved estimates of a short new question (≈ 7,000 tokens each), not for ten.
    const perQuestion = estimateAnswerTokens(0, "Frage 0".length);
    const limit = perQuestion * 3 + 10;
    await setAssistantPreference(handle.db, actor, { dailyTokenLimit: limit });
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => ask(json({ content: `Frage ${i}`, credentialId, modelId: "claude-test" }), params({ id: "new" }))),
    );
    const ok = responses.filter((r) => r.status === 200).length;
    const rows = await usage(actor);
    const used = rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);
    console.log(`[#519 scenario 2] limit ${limit} tokens, ${ok} of 10 parallel answers, ${used} tokens booked`);
    expect(ok).toBe(3);
    // Every reservation was settled with the real tokens (or released): nothing above the limit, no estimate left.
    expect(used).toBe(ok * (USAGE.inputTokens + USAGE.outputTokens));
    expect(used).toBeLessThanOrEqual(limit);
    const refused = responses.filter((r) => r.status !== 200);
    expect(refused.every((r) => r.status === 422)).toBe(true);
  });

  it("3: double click on second opinion and cross-check stores one record each and books only what ran", async () => {
    actor = await freshActor();
    await setAssistantPreference(handle.db, actor, { reviewerCredentialId: credentialId, reviewerModelId: "reviewer-test" });
    const chat = await createAssistantChat(handle.db, actor, { title: "Race" });
    await addAssistantMessage(handle.db, actor, chat.id, { role: "user", content: "Frage" });
    const answer = await addAssistantMessage(handle.db, actor, chat.id, { role: "assistant", content: "Antwort A", model: "anthropic/author-model" });
    await addAssistantMessage(handle.db, actor, chat.id, { role: "assistant", content: "Antwort B", model: "anthropic/checker-model" });

    const reviews = await Promise.all([1, 2].map(() => review(json({}), params({ id: chat.id, messageId: answer.id }))));
    const opinions = (await handle.db.select().from(schema.assistantMessage)).filter((m) => m.reviewOf === answer.id);
    expect(opinions).toHaveLength(1);
    expect(reviews.filter((r) => r.status === 201)).toHaveLength(1);

    const participants = [
      { credentialId, modelId: "author-model" },
      { credentialId, modelId: "checker-model" },
    ];
    const checks = await Promise.all([1, 2].map(() => check(json({ participants }), params({ id: chat.id, messageId: answer.id }))));
    const stored = (await handle.db.select().from(schema.assistantCheck)).filter((c) => c.messageId === answer.id);
    expect(stored).toHaveLength(1);
    expect(checks.filter((r) => r.status === 201)).toHaveLength(1);
    // The second click is refused before the model runs: one paid call each, not two.
    const booked = (await usage(actor)).map((r) => r.kind).sort();
    expect(booked).toEqual(["cross_check", "second_opinion"]);
  });

  it("4: an aborted question stores no half answer and books nothing", async () => {
    actor = await freshActor();
    delay = 500;
    const controller = new AbortController();
    const pending = ask(json({ content: "Lange Frage", credentialId, modelId: "claude-test" }, controller.signal), params({ id: "new" }));
    setTimeout(() => controller.abort(), 50);
    const response = await pending;
    delay = 40;
    expect(response.status).not.toBe(200);
    expect(await usage(actor)).toHaveLength(0);
    const chats = (await handle.db.select().from(schema.assistantChat)).filter((c) => c.userId === actor.userId).map((c) => c.id);
    const answers = (await handle.db.select().from(schema.assistantMessage)).filter((m) => chats.includes(m.chatId) && m.role === "assistant");
    expect(answers).toHaveLength(0);
  });

  it("5: the shared rate limit of 20 per minute refuses the 21st request of a user", async () => {
    actor = await freshActor();
    const responses = await Promise.all(Array.from({ length: 21 }, () => ask(json({ content: "" }), params({ id: "new" }))));
    // Empty questions fail validation (422) after the rate limit check – so only the limiter can return 429.
    expect(responses.filter((r) => r.status === 429)).toHaveLength(1);
  });
});
