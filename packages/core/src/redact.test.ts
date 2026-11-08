import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets (#403)", () => {
  it("hides every Consyrion token type and provider keys", () => {
    const tail = "a".repeat(30);
    const text = `full cns_${tail} integration cni_${tail} read cnr_${tail} anthropic sk-ant-${tail} github ghp_${tail}`;
    const out = redactSecrets(text);
    for (const prefix of ["cns_", "cni_", "cnr_", "sk-ant-", "ghp_"]) expect(out).not.toContain(prefix + tail);
    expect(out.match(/\[redacted\]/g)).toHaveLength(5);
  });

  it("leaves ordinary text alone and can be called repeatedly (global regex state)", () => {
    expect(redactSecrets("connection refused")).toBe("connection refused");
    expect(redactSecrets(`cni_${"b".repeat(25)}`)).toBe("[redacted]");
    expect(redactSecrets(`cni_${"b".repeat(25)}`)).toBe("[redacted]");
  });
});
