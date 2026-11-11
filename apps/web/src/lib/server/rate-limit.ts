import { DomainError } from "@consyrium/core";

/**
 * In-memory fixed-window limiter for expensive or abusable endpoints (per process). With several web
 * instances use a shared store; the limits here are a first line of defence, not billing.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new DomainError("RATE_LIMITED", "Too many requests – please wait a moment");
  if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
}
