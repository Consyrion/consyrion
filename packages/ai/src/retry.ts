import { ProviderError } from "./errors";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Retries only failures classified as retryable (rate limits, timeouts, 5xx) with jittered backoff. */
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt >= options.retries || options.signal?.aborted) throw error;
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
      await sleep(backoff / 2 + Math.random() * (backoff / 2), options.signal);
    }
  }
}

/**
 * Default SDK-level timeout of every adapter: only a backstop. The real deadline of a call is the caller's signal
 * (council 180 s / GLM 300 s, coding tasks 300 s, model discovery 15 s). An SDK timeout below that deadline used to
 * cut slow answers first and count as a retryable timeout – up to three waits for one call (#120).
 */
export const SDK_BACKSTOP_TIMEOUT_MS = 900_000;

/** Combines a caller's cancellation signal with a per-call timeout. */
export function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
