import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ getDb: async () => null }));
const { approvableNow } = await import("./assistant-tools");

describe("approvable for MCP clients (Windows smoke test 08.11.26)", () => {
  it("is false for no_qualifying_solution without an approvable proposal", () => {
    expect(approvableNow({ approvable: true, canApproveRecommendation: false, approvableProposalIds: [] })).toBe(false);
  });
  it("is true when the recommendation or an alternative can be approved, false when the outcome does not allow it", () => {
    expect(approvableNow({ approvable: true, canApproveRecommendation: true, approvableProposalIds: ["p1"] })).toBe(true);
    expect(approvableNow({ approvable: true, canApproveRecommendation: false, approvableProposalIds: ["p2"] })).toBe(true);
    expect(approvableNow({ approvable: false, canApproveRecommendation: false, approvableProposalIds: ["p2"] })).toBe(false);
  });
});
