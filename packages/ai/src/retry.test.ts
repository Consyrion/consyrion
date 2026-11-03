import { describe, expect, it, vi } from "vitest";
import { kindFromStatus, ProviderError } from "./errors";
import { withRetry } from "./retry";

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("retries retryable errors up to the limit", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError("openai", "rate_limit", "429"))
      .mockResolvedValue("ok");
    expect(await withRetry(op, { retries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep })).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth or bad-request errors", async () => {
    const op = vi.fn().mockRejectedValue(new ProviderError("openai", "auth", "401"));
    await expect(withRetry(op, { retries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep })).rejects.toMatchObject({ kind: "auth" });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const op = vi.fn().mockRejectedValue(new ProviderError("google", "unavailable", "503"));
    await expect(withRetry(op, { retries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep })).rejects.toMatchObject({ kind: "unavailable" });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const op = vi.fn().mockRejectedValue(new ProviderError("google", "timeout", "t"));
    await expect(withRetry(op, { retries: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, signal: controller.signal })).rejects.toBeInstanceOf(ProviderError);
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("kindFromStatus", () => {
  it("names a 404 as a model that is not available for the key, and does not retry it (#144)", () => {
    expect(kindFromStatus(404)).toBe("model_not_found");
    expect(new ProviderError("google", kindFromStatus(404), "Gemini API error 404", 404).retryable).toBe(false);
    expect(kindFromStatus(400)).toBe("bad_request");
  });
});
