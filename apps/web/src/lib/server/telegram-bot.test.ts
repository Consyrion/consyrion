import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createDatabase,
  createDeliveryConnection,
  enableTelegramInbound,
  ensurePersonalOrganization,
  listDeliveryConnections,
  resolveActor,
  schema,
  setSubscriptionPlan,
  telegramInboundForWebhook,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { handleTelegramUpdate, parseBudget, parseQuestion, questionLocale } = await import("./telegram-bot");

const BOT_TOKEN = "123456789:AAH-test-token-abcdefghijklmnopqrstuvw";
const CHAT = "555000111";
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
let handle: DatabaseHandle;
let actor: ActorContext;
let orgId: string;
let connectionId: string;
const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
/** Fake Telegram Bot API (test double): records every call, answers ok. */
const fakeFetch = (async (url: string, init?: RequestInit) => {
  sent.push({ method: String(url).split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
}) as typeof fetch;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u", name: "U", email: "u@example.test" });
  orgId = (await ensurePersonalOrganization(handle.db, "u", "U")).id;
  actor = await resolveActor(handle.db, "u", orgId);
  connectionId = (await createDeliveryConnection(handle.db, actor, keyring, { kind: "telegram", label: "Mein Bot", chatId: CHAT, secret: BOT_TOKEN })).id;
});
afterAll(async () => {
  await handle.close();
});
beforeEach(() => {
  sent.length = 0;
});

const inbound = async () => (await telegramInboundForWebhook(handle.db, keyring, connectionId, "s3cret-webhook"))!;
const message = (text: string, from = Number(CHAT)) => ({ message: { chat: { id: from, type: "private" }, from: { id: from }, text } });

describe("questions over Telegram", () => {
  it("parses the question and the user's '- ' requirement lines", () => {
    expect(parseQuestion("/frage Postgres oder SQLite?\n- muss unter 20 € kosten\n• Backups ohne Ausfall")).toEqual({
      question: "Postgres oder SQLite?",
      requirements: ["muss unter 20 € kosten", "Backups ohne Ausfall"],
    });
  });

  it("proposes 'must' lines as requirements when there are no '- ' lines and follows the question's language (night test R4)", () => {
    const text =
      "/frage A European online retailer needs to choose a customer notification system. Which option should we choose?\nThe p95 notification delivery time must be strictly below 60 seconds.\nThe system must reach at least 95% of customers.";
    expect(parseQuestion(text)).toEqual({
      question: "A European online retailer needs to choose a customer notification system. Which option should we choose?",
      requirements: ["The p95 notification delivery time must be strictly below 60 seconds.", "The system must reach at least 95% of customers."],
    });
    expect(questionLocale(text, "de")).toBe("en");
    expect(questionLocale("/frage Sollen wir die Mitglieder per E-Mail oder in einer Gruppe informieren, und was ist für den Verein besser?", "en")).toBe("de");
    expect(questionLocale("/frage ok?", "de")).toBe("de");
  });

  it("reads an optional budget line and keeps it out of the question (night test R4)", () => {
    expect(parseBudget("/frage X oder Y?\n- muss billig sein\nBudget: 180000")).toBe(180_000);
    expect(parseBudget("/frage X?\nbudget 150k")).toBe(150_000);
    expect(parseBudget("/frage X?\nBudget: 10")).toBe(50_000);
    expect(parseBudget("/frage X?\nBudget: 9000000")).toBe(300_000);
    expect(parseBudget("/frage Welches Budget passt?")).toBeNull();
    expect(parseQuestion("/frage X oder Y?\n- muss billig sein\nBudget: 180000")).toEqual({ question: "X oder Y?", requirements: ["muss billig sein"] });
  });

  it("lets only the person who connected the chat switch on questions (#408)", async () => {
    await handle.db.insert(schema.user).values({ id: "adm2", name: "Admin", email: "adm2@example.test" });
    await handle.db.insert(schema.membership).values({ id: "mem_adm2", organizationId: orgId, userId: "adm2", role: "admin" });
    const admin = await resolveActor(handle.db, "adm2", orgId);
    await expect(enableTelegramInbound(handle.db, admin, keyring, connectionId, "s3cret-webhook", "de")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("works only in a private chat and only with the right webhook secret; the secret's hash is never listed", async () => {
    await expect(
      createDeliveryConnection(handle.db, actor, keyring, { kind: "telegram", label: "Gruppe", chatId: "-1001234567890", secret: BOT_TOKEN }).then((c) =>
        enableTelegramInbound(handle.db, actor, keyring, c.id, "x", "de"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const enabled = await enableTelegramInbound(handle.db, actor, keyring, connectionId, "s3cret-webhook", "de");
    expect(enabled).toEqual({ botToken: BOT_TOKEN, chatId: CHAT });
    expect(await telegramInboundForWebhook(handle.db, keyring, connectionId, "wrong")).toBeNull();
    expect((await inbound()).userId).toBe("u");
    const listed = (await listDeliveryConnections(handle.db, actor)).find((c) => c.id === connectionId)!;
    expect(listed.config).not.toHaveProperty("inboundSecretHash");
    expect(listed.config.inboundEnabledAt).toBeTruthy();
  });

  it("ignores other chats, needs Pro, and asks before starting – the user taps Start or Cancel", async () => {
    const deps = { db: handle.db, keyring, inbound: await inbound(), fetch: fakeFetch, appUrl: "https://app.example" };
    expect(await handleTelegramUpdate(message("/frage Hallo?", 999), deps)).toEqual({ ignored: true });
    expect(sent).toHaveLength(0);

    expect(await handleTelegramUpdate(message("/frage Postgres oder SQLite?"), deps)).toEqual({ refused: true });
    expect(String(sent[0]!.body.text)).toContain("Pro");

    await setSubscriptionPlan(handle.db, "u", orgId, "pro");
    sent.length = 0;
    // No earlier council → no models to use.
    expect(await handleTelegramUpdate(message("/frage Postgres oder SQLite?\n- muss günstig sein"), deps)).toEqual({ noModels: true });
    expect(String(sent[0]!.body.text)).toContain("Council");

    sent.length = 0;
    expect(await handleTelegramUpdate(message("/hilfe"), deps)).toEqual({ help: true });
    expect(String(sent[0]!.body.text)).toContain("/frage");
  });

  it("a Start/Cancel tap from another chat or for an unknown request does nothing", async () => {
    const deps = { db: handle.db, keyring, inbound: await inbound(), fetch: fakeFetch, appUrl: "https://app.example" };
    const tap = (data: string, from = Number(CHAT)) => ({
      callback_query: { id: "cb1", from: { id: from }, data, message: { chat: { id: from }, message_id: 7 } },
    });
    expect(await handleTelegramUpdate(tap("go:tgr_x", 999), deps)).toEqual({ ignored: true });
    expect(await handleTelegramUpdate(tap("go:tgr_unknown"), deps)).toEqual({ duplicate: true });
  });
});
