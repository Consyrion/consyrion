import "server-only";
import { approximateCost, listPriceHints, type ActorContext, type Database } from "@consyrium/db";

/**
 * Approximate cost of each assistant answer (#281), from the prices the workspace entered for its models
 * (Settings → Billing & usage; BYOK – CONSYRIUM never bills tokens). Transparency only: null when no price is set for
 * that model, so nothing is invented. Messages store the model as "provider/modelId".
 */
export interface AssistantCost {
  amount: number;
  currency: string;
}

type PricedMessage = { role: string; model?: string | null; inputTokens?: number | null; outputTokens?: number | null };

export function costOf(
  message: PricedMessage,
  hints: ReadonlyArray<{ provider: string; modelId: string; inputPerMillion: string; outputPerMillion: string; currency: string }>,
): AssistantCost | null {
  if (message.role !== "assistant" || !message.model || message.inputTokens == null) return null;
  const slash = message.model.indexOf("/");
  const [provider, modelId] = slash > 0 ? [message.model.slice(0, slash), message.model.slice(slash + 1)] : [null, message.model];
  const hint = hints.find((h) => h.modelId === modelId && (!provider || h.provider === provider));
  const amount = approximateCost(hint, message.inputTokens ?? 0, message.outputTokens ?? 0);
  return hint && amount !== null ? { amount, currency: hint.currency } : null;
}

/** Adds `cost` to every message (null for questions and unpriced models). */
export async function withCosts<T extends PricedMessage>(db: Database, actor: ActorContext, messages: T[]): Promise<Array<T & { cost: AssistantCost | null }>> {
  const hints = await listPriceHints(db, actor);
  return messages.map((m) => ({ ...m, cost: costOf(m, hints) }));
}
