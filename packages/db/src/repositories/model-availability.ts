import { assertCan } from "@consyrion/core";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { usageRecord } from "../schema";
import type { ActorContext } from "./context";

type ProviderId = (typeof usageRecord.provider.enumValues)[number];

/**
 * Model availability per workspace. Providers sometimes list a model that the key may not call (Google lists
 * gemini-2.5-pro for new keys but answers 404). The start of a council therefore checks every model with one tiny call,
 * and the model picker shows a hint for a model whose latest call in this workspace ended with "model not found".
 *
 * Nothing is blocked permanently: the hint comes only from the call log, a later successful call (or the next start
 * check) clears it, and it expires on its own after HINT_HOURS. When the provider enables the model again, the next
 * start check simply succeeds.
 */
export const UNAVAILABLE_HINT_HOURS = 24;

/** Records the start check of one model as an ordinary usage row (real tokens on the user's key, no session). */
export async function recordModelCheck(
  db: Database,
  ctx: ActorContext,
  input: {
    provider: ProviderId;
    modelId: string;
    ok: boolean;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    errorKind?: string | null;
    httpStatus?: number | null;
  },
) {
  assertCan(ctx.role, "decision:run");
  await db.insert(usageRecord).values({
    id: newId("use"),
    organizationId: ctx.organizationId,
    provider: input.provider,
    modelId: input.modelId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    durationMs: input.durationMs,
    outcome: input.ok ? "ok" : "error",
    errorKind: input.ok ? null : (input.errorKind ?? null),
    httpStatus: input.ok ? null : (input.httpStatus ?? null),
  });
}

/**
 * Models whose latest call in this workspace within the last UNAVAILABLE_HINT_HOURS ended with "model not found".
 * A newer call with any other outcome means the model answered again, so it is not listed.
 */
export async function recentlyUnavailableModels(db: Database, ctx: ActorContext, now: Date = new Date()) {
  assertCan(ctx.role, "org:read");
  const since = new Date(now.getTime() - UNAVAILABLE_HINT_HOURS * 3_600_000);
  const rows = await db
    .select({ provider: usageRecord.provider, modelId: usageRecord.modelId, errorKind: usageRecord.errorKind, createdAt: usageRecord.createdAt })
    .from(usageRecord)
    .where(and(eq(usageRecord.organizationId, ctx.organizationId), gte(usageRecord.createdAt, since)))
    .orderBy(desc(usageRecord.createdAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.provider}:${row.modelId.toLowerCase()}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()]
    .filter((row) => row.errorKind === "model_not_found")
    .map((row) => ({ provider: row.provider, modelId: row.modelId, at: row.createdAt }));
}
