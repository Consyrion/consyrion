import type { ProviderId } from "./types";

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "model_not_found"
  | "bad_request"
  | "invalid_output"
  | "cancelled"
  | "unknown";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["rate_limit", "timeout", "unavailable"]);

/** Normalized provider failure. Messages never include request bodies or API keys. */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
    /** The caller's own deadline ended the request: retrying it would wait the full deadline again (#120). */
    readonly deadline = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Transient failures only. A reached deadline is not retried here; the caller decides (one longer attempt). */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind) && !this.deadline;
  }
}

export function kindFromStatus(status: number | undefined): ProviderErrorKind {
  if (status === undefined) return "unavailable";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  // The key works, but this model is not available to it (e.g. Gemini 2.5 Flash-Lite listed but answering 404, #144).
  if (status === 404) return "model_not_found";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "unknown";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

const nameOf = (value: unknown) => (value && typeof value === "object" && "name" in value ? String(value.name) : "");

/**
 * An aborted request as a provider error (#120). The SDKs report every abort alike; the signal's reason tells a
 * deadline (`AbortSignal.timeout` → TimeoutError, retryable within limits) from a cancellation by the caller
 * (never retried automatically).
 */
export function abortError(provider: ProviderId, error: unknown, signal?: AbortSignal): ProviderError {
  const deadline = nameOf(signal?.reason) === "TimeoutError" || nameOf(error) === "TimeoutError";
  return deadline
    ? new ProviderError(provider, "timeout", "No answer before the call deadline", undefined, true)
    : new ProviderError(provider, "cancelled", "Request was cancelled");
}
