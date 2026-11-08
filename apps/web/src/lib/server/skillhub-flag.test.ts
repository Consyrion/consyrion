import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assertSkillHubPublishEnabled, skillHubPublishEnabled } = await import("./skillhub-flag");

describe("SKILLHUB_PUBLISH flag (#368)", () => {
  it("is off unless explicitly switched on, and the guard refuses as not found", () => {
    expect(skillHubPublishEnabled({})).toBe(false);
    expect(skillHubPublishEnabled({ SKILLHUB_PUBLISH: "0" })).toBe(false);
    expect(skillHubPublishEnabled({ SKILLHUB_PUBLISH: " TRUE " })).toBe(true);
    expect(() => assertSkillHubPublishEnabled({})).toThrow(/Not found/);
    expect(() => assertSkillHubPublishEnabled({ SKILLHUB_PUBLISH: "1" })).not.toThrow();
  });
});
