import { describe, expect, it } from "vitest";
import { filterRequirementRows, REQUIREMENT_CELL, requirementCellKey } from "./requirement-status";

describe("one status per requirement cell (#266)", () => {
  it("a confirmed build or measurement plan is never 'met'", () => {
    expect(requirementCellKey({ status: "PASS" })).toBe("PASS");
    expect(requirementCellKey({ status: "PASS", buildVerification: true })).toBe("PLAN");
    expect(requirementCellKey({ status: "PASS", measurementPending: true })).toBe("MEASURE");
    expect(requirementCellKey({ status: "DISPUTED" })).toBe("DISPUTED");
    expect(requirementCellKey(undefined)).toBe("UNKNOWN");
  });

  it("DISPUTED and UNKNOWN differ in symbol, frame and tone – not only in colour", () => {
    expect(REQUIREMENT_CELL.DISPUTED.icon).not.toBe(REQUIREMENT_CELL.UNKNOWN.icon);
    expect(REQUIREMENT_CELL.DISPUTED.className).toContain("border-dashed");
    expect(REQUIREMENT_CELL.UNKNOWN.className).not.toContain("border-dashed");
    expect(REQUIREMENT_CELL.DISPUTED.tone).not.toBe(REQUIREMENT_CELL.UNKNOWN.tone);
  });
});

describe("heatmap search and 'problems only' (#266 part B)", () => {
  const rows = [
    { id: "r1", short: "R1", text: "Latency below 30 ms" },
    { id: "r2", short: "R2", text: "GDPR storage in the EU" },
    { id: "r3", short: "R3", text: "Runs on the existing server" },
  ];
  const req = (requirementId: string, status: "PASS" | "FAIL" | "UNKNOWN", extra = {}) => ({
    requirementId,
    status,
    pass: [],
    fail: [],
    unknown: [],
    open: [],
    conflicts: [],
    ...extra,
  });
  const gate = {
    proposals: [
      { requirements: [req("r1", "PASS"), req("r2", "UNKNOWN"), req("r3", "PASS", { measurementPending: true })] },
      { requirements: [req("r1", "PASS"), req("r2", "PASS"), req("r3", "PASS")] },
    ],
  };
  it("keeps rows that are not met for any proposal, including an open measurement", () => {
    expect(filterRequirementRows(rows, gate as never, { query: "", onlyProblems: true }).map((r) => r.id)).toEqual(["r2", "r3"]);
  });
  it("searches id and text, case-insensitively, combined with the filter", () => {
    expect(filterRequirementRows(rows, gate as never, { query: "gdpr", onlyProblems: false }).map((r) => r.id)).toEqual(["r2"]);
    expect(filterRequirementRows(rows, gate as never, { query: "r1", onlyProblems: true })).toEqual([]);
  });
});
