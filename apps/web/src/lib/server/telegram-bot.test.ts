import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
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
} from "@consyrion/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { handleTelegramUpdate, parseQuestion } = await import("./telegram-bot");

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
