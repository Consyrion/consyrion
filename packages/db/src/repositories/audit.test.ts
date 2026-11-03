import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./audit";

describe("audit metadata", () => {
  it("drops secret-looking keys", () => {
    expect(sanitizeAuditMetadata({ provider: "openai", apiKey: "x", api_key: "x", password: "x", accessToken: "x", label: "ok" })).toEqual({ provider: "openai", label: "ok" });
  });
});
