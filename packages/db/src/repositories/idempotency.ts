import { DomainError } from "@consyrium/core";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { idempotencyKey } from "../schema";
import type { ActorContext } from "./context";

/** How long a key protects against a repeated start (#101). */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function idempotencyRequestHash(route: string, body: unknown): string {
  return createHash("sha256")
    .update(`${route}\n${JSON.stringify(body ?? null)}`)
    .digest("hex");
}

/**
 * Reserves an Idempotency-Key for the actor before a council is started. "new": the caller starts the council and then
 * calls completeIdempotency (or releaseIdempotency on failure). "replay": the same request already started a council.
 * The same key with another request, or while the first request is still running, is a conflict – never a second start.
 */
export async function beginIdempotency(
  db: Database,
  ctx: ActorContext,
  key: string,
  requestHash: string,
  now = new Date(),
): Promise<{ state: "new"; id: string } | { state: "replay"; sessionId: string }> {
  if (key.length < 1 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
    throw new DomainError("VALIDATION", "Idempotency-Key must be 1–200 visible ASCII characters");
  const scope = and(eq(idempotencyKey.organizationId, ctx.organizationId), eq(idempotencyKey.userId, ctx.userId), eq(idempotencyKey.key, key));
  // An expired key may be used again.
  await db.delete(idempotencyKey).where(and(scope, lt(idempotencyKey.createdAt, new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS))));
  const id = newId("idk");
  const inserted = await db
    .insert(idempotencyKey)
    .values({ id, organizationId: ctx.organizationId, userId: ctx.userId, key, requestHash, createdAt: now })
    .onConflictDoNothing()
    .returning({ id: idempotencyKey.id });
  if (inserted[0]) return { state: "new", id };
  const [row] = await db.select().from(idempotencyKey).where(scope);
  if (!row) throw new DomainError("CONFLICT", "The Idempotency-Key is being reused right now; retry in a moment");
  if (row.requestHash !== requestHash) throw new DomainError("CONFLICT", "This Idempotency-Key was already used for a different request");
  if (!row.sessionId) throw new DomainError("CONFLICT", "A request with this Idempotency-Key is still being processed; retry in a moment");
  return { state: "replay", sessionId: row.sessionId };
}

export async function completeIdempotency(db: Database, id: string, sessionId: string): Promise<void> {
  await db.update(idempotencyKey).set({ sessionId }).where(eq(idempotencyKey.id, id));
}

/** The start failed: the key may be used again for a corrected or repeated request. */
export async function releaseIdempotency(db: Database, id: string): Promise<void> {
  await db.delete(idempotencyKey).where(eq(idempotencyKey.id, id));
}
