import { MAX_TOKEN_BUDGET } from "@consyrium/core/browser";

/**
 * "Adjust budget" in the council form (#587): the token budget that fits the chosen team, taken from the cost preview –
 * no model call. It is the preview's upper bound (then no phase has to be shortened), rounded up to the form's step of
 * 10,000 and never above the allowed maximum. Returns null when the current budget already covers the upper bound, or
 * when even the maximum is below the minimum the team needs (then only fewer models or roles help).
 */
export function suggestedBudget(input: { tokenBudget: number; minimumBudget?: number | null; upperBound: number }): number | null {
  const STEP = 10_000;
  const wanted = Math.max(input.minimumBudget ?? 0, input.upperBound);
  if (!Number.isFinite(wanted) || wanted <= 0 || input.tokenBudget >= wanted) return null;
  const rounded = Math.min(MAX_TOKEN_BUDGET, Math.ceil(wanted / STEP) * STEP);
  if (rounded < (input.minimumBudget ?? 0) || rounded <= input.tokenBudget) return null;
  return rounded;
}
