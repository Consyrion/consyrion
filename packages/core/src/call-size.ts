/**
 * Size check before every model call (#243): the estimated input plus the requested output must fit the model's
 * context window, and the output limit must not exceed what the model can write. The limits come from the provider's
 * own models endpoint (`ai_model.context_window` / `max_output_tokens`); unknown limits are not guessed.
 *
 * The check never shortens content. It only lowers the *output limit* to what the model allows or what is left of the
 * window – and when even a minimal answer does not fit, the call is refused with a clear reason instead of being sent
 * to be cut off. The per-schema output sizing (`outputTokensFor`) and the split Final Verdict (#246) decide how much
 * output is wanted; this only makes sure the request is possible for this model.
 */

/** Input estimates are characters / 4; real tokenisers count up to ~10 % more for code and non-English text. */
export const CONTEXT_ESTIMATE_MARGIN = 0.9;

/** Below this many output tokens no structured answer of a council call is usable. */
export const MIN_USABLE_OUTPUT_TOKENS = 1_000;

export interface ModelLimits {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export type CallSize =
  | { ok: true; maxOutput: number; capped: null | "model_output_limit" | "context_window" }
  | { ok: false; reason: string; estimatedInput: number; contextWindow: number };

export function fitCallToModel(estimatedInput: number, wantedOutput: number, limits: ModelLimits): CallSize {
  let maxOutput = wantedOutput;
  let capped: null | "model_output_limit" | "context_window" = null;
  if (limits.maxOutputTokens && limits.maxOutputTokens > 0 && maxOutput > limits.maxOutputTokens) {
    maxOutput = limits.maxOutputTokens;
    capped = "model_output_limit";
  }
  if (limits.contextWindow && limits.contextWindow > 0) {
    const room = Math.floor(limits.contextWindow * CONTEXT_ESTIMATE_MARGIN) - estimatedInput;
    if (room < Math.min(MIN_USABLE_OUTPUT_TOKENS, maxOutput))
      return {
        ok: false,
        estimatedInput,
        contextWindow: limits.contextWindow,
        reason: `input of about ${estimatedInput.toLocaleString("en-US")} tokens leaves no room for an answer in the model's context window of ${limits.contextWindow.toLocaleString("en-US")} tokens – use a model with a larger window or a smaller repository context`,
      };
    if (maxOutput > room) {
      maxOutput = room;
      capped = "context_window";
    }
  }
  return { ok: true, maxOutput, capped };
}

/**
 * Start screen (#243): whether the brief (with documents and repository context) leaves room for answers in a model's
 * window. `null` when the provider does not report the window.
 */
export function contextFits(estimatedInput: number, wantedOutput: number, contextWindow: number | null): boolean | null {
  if (!contextWindow || contextWindow <= 0) return null;
  return Math.floor(contextWindow * CONTEXT_ESTIMATE_MARGIN) - estimatedInput >= Math.min(MIN_USABLE_OUTPUT_TOKENS, wantedOutput);
}
