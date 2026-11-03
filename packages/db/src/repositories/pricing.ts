import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { modelPriceHint } from "../schema";
import type { ActorContext } from "./context";

const decimal = /^\d{1,6}(\.\d{1,6})?$/;

/** Organization-entered prices for approximate cost display (transparency only, BYOK). */
export async function setPriceHint(db: Database, ctx: ActorContext, input: { provider: "anthropic" | "openai" | "google" | "deepseek" | "glm" | "kimi" | "qwen" | "xai"; modelId: string; inputPerMillion: string; outputPerMillion: string; currency: string }) {
  assertCan(ctx.role, "credential:write");
  if (!decimal.test(input.inputPerMillion) || !decimal.test(input.outputPerMillion)) throw new DomainError("VALIDATION", "Prices must be decimal numbers");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new DomainError("VALIDATION", "Currency must be a 3-letter code");
  await db
    .insert(modelPriceHint)
    .values({ id: newId("prc"), organizationId: ctx.organizationId, ...input })
    .onConflictDoUpdate({ target: [modelPriceHint.organizationId, modelPriceHint.provider, modelPriceHint.modelId], set: { inputPerMillion: input.inputPerMillion, outputPerMillion: input.outputPerMillion, currency: input.currency } });
}

export async function listPriceHints(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:read");
  return db.select().from(modelPriceHint).where(eq(modelPriceHint.organizationId, ctx.organizationId)).orderBy(asc(modelPriceHint.provider), asc(modelPriceHint.modelId));
}

export async function deletePriceHint(db: Database, ctx: ActorContext, id: string) {
  assertCan(ctx.role, "credential:write");
  await db.delete(modelPriceHint).where(and(eq(modelPriceHint.id, id), eq(modelPriceHint.organizationId, ctx.organizationId)));
}

export function approximateCost(hint: { inputPerMillion: string; outputPerMillion: string } | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!hint) return null;
  return (inputTokens * Number(hint.inputPerMillion) + outputTokens * Number(hint.outputPerMillion)) / 1_000_000;
}
