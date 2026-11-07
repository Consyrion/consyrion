import { assertCan, decryptSecret, DomainError, encryptSecret, maskSecret, type Keyring } from "@consyrion/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { councilSession, deliveryConnection, deliveryLog, project } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

/** Connections a decision can be sent to (#165). Secrets are encrypted like provider keys and never returned. */
export const deliveryConnectionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("telegram"),
    label: z.string().trim().min(1).max(60),
    /** Chat, group or channel id the bot posts to (e.g. 123456789 or -100…). */
    chatId: z
      .string()
      .trim()
      .regex(/^-?\d{3,20}$|^@[A-Za-z0-9_]{5,64}$/, "Chat id: a number like 123456789 / -100… or @channelname"),
    secret: z
      .string()
      .trim()
      .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, "Bot token in the form 123456:ABC… from @BotFather"),
  }),
  z.object({
    kind: z.literal("confluence"),
    label: z.string().trim().min(1).max(60),
    /** Atlassian Cloud site, e.g. https://your-team.atlassian.net */
    baseUrl: z
      .string()
      .trim()
      .url()
      .refine((u) => /^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/i.test(u), "Atlassian Cloud URL like https://your-team.atlassian.net"),
    spaceKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9~_-]{1,255}$/, "Space key, e.g. DEC"),
    email: z.string().trim().email(),
    secret: z.string().trim().min(10, "API token looks too short").max(500),
  }),
]);

const publicColumns = {
  id: deliveryConnection.id,
  kind: deliveryConnection.kind,
  label: deliveryConnection.label,
  config: deliveryConnection.config,
  secretHint: deliveryConnection.secretHint,
  createdAt: deliveryConnection.createdAt,
};

export async function createDeliveryConnection(db: Database, ctx: ActorContext, keyring: Keyring, input: z.input<typeof deliveryConnectionInput>) {
  assertCan(ctx.role, "credential:write");
  const parsed = deliveryConnectionInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid connection", z.flattenError(parsed.error));
  const { secret, kind, label, ...rest } = parsed.data;
  const config: Record<string, string> = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v).replace(/\/$/, "")]));
  const id = newId("dlc");
  try {
    await db.insert(deliveryConnection).values({
      id,
      organizationId: ctx.organizationId,
      kind,
      label,
      config,
      encryptedSecret: encryptSecret(secret, { organizationId: ctx.organizationId, credentialId: id }, keyring),
      keyVersion: keyring.activeVersion,
      secretHint: maskSecret(secret),
      createdById: ctx.userId,
    });
  } catch (error) {
    if (String((error as { cause?: unknown })?.cause ?? error).includes("delivery_connection_org_label_uq"))
      throw new DomainError("CONFLICT", `A ${kind} connection named "${label}" already exists`);
    throw error;
  }
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "delivery_connection.created",
    targetType: "delivery_connection",
    targetId: id,
    metadata: { kind, label },
  });
  const [created] = await db.select(publicColumns).from(deliveryConnection).where(eq(deliveryConnection.id, id));
  return created!;
}

export async function listDeliveryConnections(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "credential:read");
  const rows = await db
    .select(publicColumns)
    .from(deliveryConnection)
    .where(eq(deliveryConnection.organizationId, ctx.organizationId))
    .orderBy(deliveryConnection.kind, deliveryConnection.label);
  // The webhook secret's hash and the acting user stay on the server; members see only whether questions are on.
  return rows.map((r) => {
    const { inboundSecretHash, inboundUserId, ...config } = r.config;
    void inboundSecretHash;
    const visible: Record<string, string> = { ...config, ...(inboundUserId ? { inboundByMe: String(inboundUserId === ctx.userId) } : {}) };
    return { ...r, config: visible };
  });
}

export async function deleteDeliveryConnection(db: Database, ctx: ActorContext, connectionId: string) {
  assertCan(ctx.role, "credential:write");
  const deleted = await db
    .delete(deliveryConnection)
    .where(and(eq(deliveryConnection.id, connectionId), eq(deliveryConnection.organizationId, ctx.organizationId)))
    .returning({ id: deliveryConnection.id, kind: deliveryConnection.kind });
  if (!deleted[0]) throw new DomainError("NOT_FOUND", "Connection not found");
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "delivery_connection.deleted",
    targetType: "delivery_connection",
    targetId: connectionId,
    metadata: { kind: deleted[0].kind },
  });
}

/** Server-side only: the connection with its decrypted secret, for one send. */
export async function deliveryConnectionForUse(db: Database, ctx: ActorContext, keyring: Keyring, connectionId: string) {
  assertCan(ctx.role, "decision:run");
  const [row] = await db
    .select()
    .from(deliveryConnection)
    .where(and(eq(deliveryConnection.id, connectionId), eq(deliveryConnection.organizationId, ctx.organizationId)));
  if (!row) throw new DomainError("NOT_FOUND", "Connection not found");
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    config: row.config,
    secret: decryptSecret(row.encryptedSecret, { organizationId: row.organizationId, credentialId: row.id }, keyring),
  };
}

export async function recordDelivery(
  db: Database,
  ctx: ActorContext,
  entry: {
    sessionId: string;
    target: "email" | "telegram" | "confluence";
    connectionId: string | null;
    recipient: string;
    status: "sent" | "failed";
    error?: string | null;
    externalUrl?: string | null;
  },
) {
  const id = newId("dlv");
  await db.insert(deliveryLog).values({ id, organizationId: ctx.organizationId, createdById: ctx.userId, error: null, externalUrl: null, ...entry });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: entry.status === "sent" ? "decision.delivered" : "decision.delivery_failed",
    targetType: "council_session",
    targetId: entry.sessionId,
    metadata: { target: entry.target, connectionId: entry.connectionId },
  });
  return id;
}

export async function listDeliveries(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "project:read");
  return db
    .select({
      id: deliveryLog.id,
      target: deliveryLog.target,
      connectionId: deliveryLog.connectionId,
      recipient: deliveryLog.recipient,
      status: deliveryLog.status,
      error: deliveryLog.error,
      externalUrl: deliveryLog.externalUrl,
      createdAt: deliveryLog.createdAt,
    })
    .from(deliveryLog)
    .where(and(eq(deliveryLog.sessionId, sessionId), eq(deliveryLog.organizationId, ctx.organizationId)))
    .orderBy(desc(deliveryLog.createdAt));
}

/** Remembers the target of a send as the project's default ("Send to …" preselects it next time). */
export async function setProjectDeliveryDefault(
  db: Database,
  ctx: ActorContext,
  sessionId: string,
  value: { target: "email" | "telegram" | "confluence"; connectionId?: string | null; recipients?: string[] },
) {
  assertCan(ctx.role, "project:write");
  const [session] = await db
    .select({ projectId: councilSession.projectId })
    .from(councilSession)
    .where(and(eq(councilSession.id, sessionId), eq(councilSession.organizationId, ctx.organizationId)));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  await db
    .update(project)
    .set({ deliveryDefault: value })
    .where(and(eq(project.id, session.projectId), eq(project.organizationId, ctx.organizationId)));
}
