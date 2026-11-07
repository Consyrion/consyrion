import { createHash, timingSafeEqual } from "node:crypto";
import { assertCan, decryptSecret, DomainError, type Keyring } from "@consyrion/core";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { councilSession, deliveryConnection, telegramRequest } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

/**
 * Questions over Telegram (06.11.26). A workspace's own Telegram connection (#165, bot token + chat id) can also
 * RECEIVE questions: the user who switches it on is the actor every question runs as (permissions re-checked each
 * time). Only a private chat qualifies – in a group anyone could spend the workspace's tokens. The webhook secret is
 * stored as a hash in the connection's config; nothing about it is shown to other members.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const INBOUND_KEYS = ["inboundUserId", "inboundSecretHash", "inboundEnabledAt", "inboundLocale"] as const;

async function telegramConnection(db: Database, ctx: ActorContext, connectionId: string) {
  const [row] = await db
    .select()
    .from(deliveryConnection)
    .where(and(eq(deliveryConnection.id, connectionId), eq(deliveryConnection.organizationId, ctx.organizationId)));
  if (!row || row.kind !== "telegram") throw new DomainError("NOT_FOUND", "Telegram connection not found");
  return row;
}

/** Switches questions on; returns what the route needs to register the webhook (bot token and chat id). */
export async function enableTelegramInbound(db: Database, ctx: ActorContext, keyring: Keyring, connectionId: string, secret: string, locale: string) {
  assertCan(ctx.role, "credential:write");
  assertCan(ctx.role, "decision:run");
  const row = await telegramConnection(db, ctx, connectionId);
  const chatId = row.config.chatId ?? "";
  if (!/^\d{3,20}$/.test(chatId))
    throw new DomainError(
      "VALIDATION",
      "Questions work only in a private chat with the bot (a positive chat id) – in a group anyone could start councils on your keys",
    );
  const config = {
    ...row.config,
    inboundUserId: ctx.userId,
    inboundSecretHash: sha256(secret),
    inboundEnabledAt: new Date().toISOString(),
    inboundLocale: locale,
  };
  await db.update(deliveryConnection).set({ config }).where(eq(deliveryConnection.id, row.id));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "telegram.inbound_enabled",
    targetType: "delivery_connection",
    targetId: row.id,
  });
  return { botToken: decryptSecret(row.encryptedSecret, { organizationId: row.organizationId, credentialId: row.id }, keyring), chatId };
}

export async function disableTelegramInbound(db: Database, ctx: ActorContext, keyring: Keyring, connectionId: string) {
  assertCan(ctx.role, "credential:write");
  const row = await telegramConnection(db, ctx, connectionId);
  const config = Object.fromEntries(Object.entries(row.config).filter(([k]) => !(INBOUND_KEYS as readonly string[]).includes(k)));
  await db.update(deliveryConnection).set({ config }).where(eq(deliveryConnection.id, row.id));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "telegram.inbound_disabled",
    targetType: "delivery_connection",
    targetId: row.id,
  });
  return { botToken: decryptSecret(row.encryptedSecret, { organizationId: row.organizationId, credentialId: row.id }, keyring) };
}

/**
 * Webhook side (no session): the connection behind a webhook call, only when the secret matches and questions are on.
 * Returns null otherwise – the caller answers 200 without doing anything, so probing reveals nothing.
 */
export async function telegramInboundForWebhook(db: Database, keyring: Keyring, connectionId: string, secret: string) {
  const [row] = await db.select().from(deliveryConnection).where(eq(deliveryConnection.id, connectionId));
  if (!row || row.kind !== "telegram" || !row.config.inboundSecretHash || !row.config.inboundUserId) return null;
  const expected = Buffer.from(row.config.inboundSecretHash, "hex");
  const given = Buffer.from(sha256(secret), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return {
    connectionId: row.id,
    organizationId: row.organizationId,
    userId: row.config.inboundUserId,
    chatId: row.config.chatId ?? "",
    locale: row.config.inboundLocale ?? "en",
    botToken: decryptSecret(row.encryptedSecret, { organizationId: row.organizationId, credentialId: row.id }, keyring),
  };
}

export async function createTelegramRequest(db: Database, ctx: ActorContext, input: { connectionId: string; question: string; requirements: string[] }) {
  assertCan(ctx.role, "decision:run");
  // Old unanswered questions expire after a day, so a forgotten button cannot start a council much later.
  await db
    .update(telegramRequest)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(telegramRequest.status, "pending"), lt(telegramRequest.createdAt, new Date(Date.now() - 86_400_000))));
  const [row] = await db
    .insert(telegramRequest)
    .values({
      id: newId("tgr"),
      organizationId: ctx.organizationId,
      connectionId: input.connectionId,
      userId: ctx.userId,
      question: input.question,
      requirements: input.requirements,
    })
    .returning();
  return row!;
}

/** Claims a pending request for "start" or "cancel" exactly once (a double tap does nothing the second time). */
export async function claimTelegramRequest(db: Database, ctx: ActorContext, requestId: string, connectionId: string, next: "started" | "cancelled") {
  const [row] = await db
    .update(telegramRequest)
    .set({ status: next, updatedAt: new Date() })
    .where(
      and(
        eq(telegramRequest.id, requestId),
        eq(telegramRequest.connectionId, connectionId),
        eq(telegramRequest.organizationId, ctx.organizationId),
        eq(telegramRequest.userId, ctx.userId),
        eq(telegramRequest.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function setTelegramRequestSession(db: Database, requestId: string, sessionId: string | null, status?: "failed") {
  await db
    .update(telegramRequest)
    .set({ sessionId, ...(status ? { status } : {}), updatedAt: new Date() })
    .where(eq(telegramRequest.id, requestId));
}

/** Notifier side: started questions whose council has finished (verdict waiting, failed or cancelled). */
export async function finishedTelegramRequests(db: Database) {
  return db
    .select({
      id: telegramRequest.id,
      organizationId: telegramRequest.organizationId,
      userId: telegramRequest.userId,
      connectionId: telegramRequest.connectionId,
      sessionId: telegramRequest.sessionId,
      sessionStatus: councilSession.status,
    })
    .from(telegramRequest)
    .innerJoin(councilSession, eq(councilSession.id, telegramRequest.sessionId))
    .where(and(eq(telegramRequest.status, "started"), inArray(councilSession.status, ["awaiting_approval", "approved", "rejected", "failed", "cancelled"])))
    .limit(20);
}

export async function markTelegramRequest(db: Database, requestId: string, status: "delivered" | "failed") {
  await db.update(telegramRequest).set({ status, updatedAt: new Date() }).where(eq(telegramRequest.id, requestId));
}
