import { randomBytes } from "node:crypto";
import { keyringFromEnv, type Entitlements } from "@consyrion/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { membership, user } from "../schema";
import {
  addAssistantCheck,
  addAssistantMessage,
  assertAssistantBudget,
  assistantBudget,
  createAssistantChat,
  deleteAssistantChat,
  getAnswerForCheck,
  getAnswerForReview,
  releaseAssistantUsage,
  reserveAssistantUsage,
  settleAssistantUsage,
  getAssistantChat,
  getAssistantPreference,
  listAssistantChats,
  recordAssistantUsage,
  setAssistantChatSummary,
  setAssistantPreference,
} from "./assistant";
import { createCredential } from "./credentials";
import { assertEntitlement, getPlanCatalog, updatePlanDefinition } from "./saas";
import { resolveActor, type ActorContext } from "./context";
import { createOrganization, ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let alice: ActorContext;
let carol: ActorContext; // admin in Alice's workspace
let viewer: ActorContext;
let bob: ActorContext; // other workspace

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob", "carol", "vic"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
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
});

afterAll(async () => {
  await handle.close();
});

describe("assistant chats (#280): private per user and workspace", () => {
  it("stores a chat with its messages for its owner only", async () => {
    const chat = await createAssistantChat(handle.db, alice, { title: "  Which   projects wait for approval?  " });
    expect(chat.title).toBe("Which projects wait for approval?");
    await addAssistantMessage(handle.db, alice, chat.id, { role: "user", content: "Which projects wait for approval?" });
    await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "One: Todo tags.", model: "anthropic/claude-haiku-5-5", inputTokens: 900, outputTokens: 40 });
    const loaded = await getAssistantChat(handle.db, alice, chat.id);
    expect(loaded.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((await listAssistantChats(handle.db, alice)).map((c) => c.id)).toContain(chat.id);

    // Not even an admin of the same workspace, and nobody from another workspace.
    await expect(getAssistantChat(handle.db, carol, chat.id)).rejects.toThrow(/not found/i);
    await expect(getAssistantChat(handle.db, bob, chat.id)).rejects.toThrow(/not found/i);
    await expect(addAssistantMessage(handle.db, bob, chat.id, { role: "user", content: "x" })).rejects.toThrow(/not found/i);
    await expect(deleteAssistantChat(handle.db, carol, chat.id)).rejects.toThrow(/not found/i);
    expect(await listAssistantChats(handle.db, carol)).toHaveLength(0);
  });

  it("needs the permission to run decisions (it costs tokens) and deletes for real", async () => {
    await expect(listAssistantChats(handle.db, viewer)).rejects.toThrow(/permission/i);
    const chat = await createAssistantChat(handle.db, alice, { title: "temp" });
    await deleteAssistantChat(handle.db, alice, chat.id);
    await expect(getAssistantChat(handle.db, alice, chat.id)).rejects.toThrow(/not found/i);
  });
});

describe("assistant settings, budget and second opinion (#281)", () => {
  const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

  it("stores default and reviewer model per user; only own workspace keys; limits validated; other users see their own", async () => {
    const own = await createCredential(handle.db, alice, keyring, { provider: "anthropic", secret: "sk-ant-pref-test-000000000001" });
    const foreign = await createCredential(handle.db, bob, keyring, { provider: "openai", secret: "sk-pref-test-foreign-0000000002" });
    expect(await getAssistantPreference(handle.db, alice)).toMatchObject({ credentialId: null, reviewerModelId: null, dailyTokenLimit: null });
    const saved = await setAssistantPreference(handle.db, alice, { credentialId: own.id, modelId: " model-a ", reviewerCredentialId: own.id, reviewerModelId: "model-b" });
    expect(saved).toMatchObject({ credentialId: own.id, modelId: "model-a", reviewerModelId: "model-b" });
    // A partial update keeps the other fields.
    expect(await setAssistantPreference(handle.db, alice, { dailyTokenLimit: 5_000 })).toMatchObject({ modelId: "model-a", dailyTokenLimit: 5_000 });
    await expect(setAssistantPreference(handle.db, alice, { reviewerCredentialId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setAssistantPreference(handle.db, alice, { monthlyTokenLimit: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setAssistantPreference(handle.db, alice, { monthlyTokenLimit: Number.NaN })).rejects.toMatchObject({ code: "VALIDATION" });
    // Carol (admin of the same workspace) has her own, empty settings.
    expect(await getAssistantPreference(handle.db, carol)).toMatchObject({ modelId: null, dailyTokenLimit: null });
    await expect(getAssistantPreference(handle.db, viewer)).rejects.toThrow();
    expect(await setAssistantPreference(handle.db, alice, { reviewerCredentialId: null, reviewerModelId: null })).toMatchObject({ reviewerModelId: null });
  });

  it("counts the user's answer tokens per UTC day and month and refuses new questions at the limit", async () => {
    const chat = await createAssistantChat(handle.db, carol, { title: "Budget" });
    await addAssistantMessage(handle.db, carol, chat.id, { role: "user", content: "q" });
    await addAssistantMessage(handle.db, carol, chat.id, { role: "assistant", content: "a", inputTokens: 700, outputTokens: 300 });
    // Only the usage ledger counts (ChatGPT review 08.11.26), not the stored message.
    expect(await assistantBudget(handle.db, carol)).toMatchObject({ today: 0 });
    await recordAssistantUsage(handle.db, carol, "answer", { inputTokens: 600, outputTokens: 200 });
    await recordAssistantUsage(handle.db, carol, "summary", { inputTokens: 150, outputTokens: 50 });
    expect(await assistantBudget(handle.db, carol)).toMatchObject({ today: 1_000, thisMonth: 1_000, dailyLimit: null });
    // Deleting the chat (privacy) does not reset the usage.
    await deleteAssistantChat(handle.db, carol, chat.id);
    expect(await assistantBudget(handle.db, carol)).toMatchObject({ today: 1_000 });
    await setAssistantPreference(handle.db, carol, { dailyTokenLimit: 2_000, monthlyTokenLimit: 1_000 });
    await expect(assertAssistantBudget(handle.db, carol)).rejects.toThrow(/monthly assistant limit of 1000/);
    await setAssistantPreference(handle.db, carol, { monthlyTokenLimit: null });
    await expect(assertAssistantBudget(handle.db, carol)).resolves.toMatchObject({ today: 1_000 });
    await setAssistantPreference(handle.db, carol, { dailyTokenLimit: 1_000 });
    await expect(assertAssistantBudget(handle.db, carol)).rejects.toThrow(/daily assistant limit/);
    // Tomorrow the daily count starts again; Alice's usage is separate.
    await expect(assertAssistantBudget(handle.db, carol, new Date(Date.now() + 2 * 86_400_000))).resolves.toBeDefined();
    expect((await assistantBudget(handle.db, alice)).today).not.toBe(1_000);
  });

  it("finds an answer and its question for a second opinion, once, only in the user's own chat", async () => {
    const chat = await createAssistantChat(handle.db, alice, { title: "Review" });
    await addAssistantMessage(handle.db, alice, chat.id, { role: "user", content: "Welche Schritte sind offen?" });
    const answer = await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "Keine.", model: "anthropic/m" });
    const found = await getAnswerForReview(handle.db, alice, chat.id, answer.id);
    expect(found).toMatchObject({ question: "Welche Schritte sind offen?", answer: { id: answer.id } });
    await expect(getAnswerForReview(handle.db, carol, chat.id, answer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const review = await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "Teilweise richtig.", reviewOf: answer.id });
    // A parallel second opinion for the same answer is refused by the database (unique review_of).
    await expect(addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "Doppelt.", reviewOf: answer.id })).rejects.toThrow();
    await expect(getAnswerForReview(handle.db, alice, chat.id, answer.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(getAnswerForReview(handle.db, alice, chat.id, review.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("daily question limit of the plan (#281)", () => {
  it("counts the workspace's questions today and refuses once the plan's limit is reached; answers do not count", async () => {
    const catalog = await getPlanCatalog(handle.db);
    const starter = catalog.find((p) => p.key === "starter")!;
    expect(starter.entitlements).toMatchObject({ maxAssistantQuestionsPerDay: 50 });
    await updatePlanDefinition(handle.db, "alice", "starter", {
      name: starter.name,
      entitlements: { ...(starter.entitlements as unknown as Entitlements), maxAssistantQuestionsPerDay: 2 },
      priceLabel: starter.priceLabel,
      stripePriceId: starter.stripePriceId,
      active: starter.active,
    });
    // Bob's own workspace (Starter): no question yet today.
    await expect(assertEntitlement(handle.db, bob.organizationId, "assistant")).resolves.toBeUndefined();
    const chat = await createAssistantChat(handle.db, bob, { title: "Limit" });
    // A question without an answer (provider failed) does not count; second opinions and summaries are not questions.
    await addAssistantMessage(handle.db, bob, chat.id, { role: "user", content: "q0" });
    await recordAssistantUsage(handle.db, bob, "second_opinion", { inputTokens: 1, outputTokens: 1 });
    await recordAssistantUsage(handle.db, bob, "summary", { inputTokens: 1, outputTokens: 1 });
    await recordAssistantUsage(handle.db, bob, "answer", { inputTokens: 1, outputTokens: 1 });
    await expect(assertEntitlement(handle.db, bob.organizationId, "assistant")).resolves.toBeUndefined();
    await recordAssistantUsage(handle.db, bob, "answer", { inputTokens: 1, outputTokens: 1 });
    await expect(assertEntitlement(handle.db, bob.organizationId, "assistant")).rejects.toThrow(/2 assistant question\(s\) per day/);
    // Further answers of a council chat turn (#241) do not count as extra questions.
    await recordAssistantUsage(handle.db, bob, "council_answer", { inputTokens: 1, outputTokens: 1 });
    // Deleting the chat does not give the questions back.
    await deleteAssistantChat(handle.db, bob, chat.id);
    await expect(assertEntitlement(handle.db, bob.organizationId, "assistant")).rejects.toThrow(/per day/);
  });
});

describe("chat summary (#280)", () => {
  it("stores the summary only for the chat's owner", async () => {
    const chat = await createAssistantChat(handle.db, alice, { title: "Long" });
    const until = new Date();
    await setAssistantChatSummary(handle.db, alice, chat.id, "  - Kurzfassung  ", until);
    const loaded = await getAssistantChat(handle.db, alice, chat.id);
    expect(loaded.chat).toMatchObject({ summary: "- Kurzfassung" });
    expect(loaded.chat.summaryUntil?.getTime()).toBe(until.getTime());
    await expect(setAssistantChatSummary(handle.db, carol, chat.id, "x", until)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cross-check in the council chat (#241 stage 2)", () => {
  it("stores one check per answer and model, only for the chat's owner, and loads it with the chat", async () => {
    const chat = await createAssistantChat(handle.db, alice, { title: "Council" });
    await addAssistantMessage(handle.db, alice, chat.id, { role: "user", content: "Postgres oder SQLite?" });
    const a = await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "SQLite reicht.", model: "anthropic/claude-haiku-5-5" });
    await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "Postgres.", model: "openai/gpt-5.4-mini" });

    const before = await getAnswerForCheck(handle.db, alice, chat.id, a.id);
    expect(before).toMatchObject({ question: "Postgres oder SQLite?", checkedBy: [] });
    const check = { messageId: a.id, model: "openai/gpt-5.4-mini", verdict: "contradicted" as const, reason: "Backups fehlen.", inputTokens: 10, outputTokens: 5 };
    await addAssistantCheck(handle.db, alice, chat.id, check);
    // The same model checks an answer once – also when two requests race.
    await expect(addAssistantCheck(handle.db, alice, chat.id, check)).rejects.toMatchObject({ code: "CONFLICT" });
    // Another member of the workspace and another workspace cannot see or add checks.
    await expect(addAssistantCheck(handle.db, carol, chat.id, { ...check, model: "x/y" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAnswerForCheck(handle.db, bob, chat.id, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // An answer of another chat cannot be checked through this chat.
    const other = await createAssistantChat(handle.db, alice, { title: "Other" });
    await expect(addAssistantCheck(handle.db, alice, other.id, { ...check, model: "x/z" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const loaded = await getAssistantChat(handle.db, alice, chat.id);
    expect(loaded.checks).toEqual([expect.objectContaining({ messageId: a.id, verdict: "contradicted", reason: "Backups fehlen." })]);
    expect((await getAnswerForCheck(handle.db, alice, chat.id, a.id)).checkedBy).toEqual(["openai/gpt-5.4-mini"]);

    // Checks count toward the user's token limits through the ledger, and deleting the chat removes the checks.
    const used = (await assistantBudget(handle.db, alice)).today;
    await recordAssistantUsage(handle.db, alice, "cross_check", { inputTokens: 10, outputTokens: 5 });
    expect((await assistantBudget(handle.db, alice)).today).toBe(used + 15);
    await deleteAssistantChat(handle.db, alice, chat.id);
    await expect(getAssistantChat(handle.db, alice, chat.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("token reservation (#519)", () => {
  it("reserves the estimate against the daily limit, refuses what would pass it and books the real tokens", async () => {
    await setAssistantPreference(handle.db, bob, { dailyTokenLimit: null, monthlyTokenLimit: null });
    const before = (await assistantBudget(handle.db, bob)).today;
    await setAssistantPreference(handle.db, bob, { dailyTokenLimit: before + 10_000 });
    const first = await reserveAssistantUsage(handle.db, bob, { kind: "second_opinion", estimate: 6_000 });
    // The running estimate counts: a second call of 6,000 would pass the limit.
    await expect(reserveAssistantUsage(handle.db, bob, { kind: "cross_check", estimate: 6_000 })).rejects.toThrow(/needs about 6000 tokens/);
    // Real tokens replace the estimate and free the rest.
    await settleAssistantUsage(handle.db, bob, first, { inputTokens: 900, outputTokens: 100 });
    expect((await assistantBudget(handle.db, bob)).today).toBe(before + 1_000);
    const second = await reserveAssistantUsage(handle.db, bob, { kind: "cross_check", estimate: 6_000 });
    // A call without an answer gives its reservation back.
    await releaseAssistantUsage(handle.db, bob, second);
    expect((await assistantBudget(handle.db, bob)).today).toBe(before + 1_000);
    await setAssistantPreference(handle.db, bob, { dailyTokenLimit: null });
  });
});
