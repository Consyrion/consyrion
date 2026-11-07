import { describe, expect, it } from "vitest";
import { redact } from "./logger";
import { rateLimit } from "./rate-limit";

describe("log redaction", () => {
  it("removes secrets by key and by value pattern", () => {
    const out = JSON.stringify(
      redact({ apiKey: "x", nested: { authorization: "Bearer y" }, message: "failed with sk-ant-abcdefghijklmnop and cns_" + "a".repeat(30), safe: "hello" }),
    );
    expect(out).not.toContain("sk-ant-abcdefghijklmnop");
    expect(out).not.toContain("Bearer y");
    expect(out).not.toContain("a".repeat(30));
    expect(out).toContain("hello");
  });
});

describe("rate limit", () => {
  it("blocks after the limit within a window and resets afterwards", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000, 0);
    expect(() => rateLimit("k", 3, 1000, 10)).toThrow(/Too many/);
    expect(() => rateLimit("k", 3, 1000, 2000)).not.toThrow();
  });
});
