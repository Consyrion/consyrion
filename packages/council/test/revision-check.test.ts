import { describe, expect, it } from "vitest";
import { changedFields, revisionProblem, sameContent } from "../src/revision-check";

const before = { title: "CSV export", summary: "CSV first", recommendations: ["Add push after at least two missed deadlines or above 10 %"] };

describe("revision check (#94)", () => {
  it("compares content regardless of key order and lists changed fields", () => {
    expect(sameContent({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(changedFields(before, { ...before, recommendations: ["Add push when documented requirements demand it"] })).toEqual(["recommendations"]);
  });

  it("rejects claimed changes with unchanged content, also when the position is kept", () => {
    const hollow = { keepPosition: true, content: before, changes: [{ change: "Replaced the invented push threshold", motivatedBy: ["obj_1"] }] };
    expect(revisionProblem(before, hollow, [])).toContain("identical to the current version");
    // Keeping the position without claiming changes is fine.
    expect(revisionProblem(before, { keepPosition: true, content: before, changes: [{ change: "Position kept", motivatedBy: [] }] }, [])).toBeNull();
  });

  it("requires a content change after a conceded objection (the id reference is optional)", () => {
    const conceded = [{ id: "obj_1", conceded: true, status: "accepted" }];
    const fixed = { keepPosition: true, content: { ...before, recommendations: ["Add push when documented requirements demand it"] }, changes: [{ change: "Removed the invented thresholds", motivatedBy: ["obj_1"] }] };
    expect(revisionProblem(before, fixed, conceded)).toBeNull();
    // Real models often omit the id: a real content change is enough, the link is then noted as missing.
    const unreferenced = { ...fixed, changes: [{ change: "Removed the invented thresholds", motivatedBy: [] }] };
    expect(revisionProblem(before, unreferenced, conceded)).toBeNull();
    // No content change at all after conceding is still rejected.
    expect(revisionProblem(before, { keepPosition: true, content: before, changes: [] }, conceded)).toContain("objection obj_1 was conceded");
    // Not conceded: the author may keep it; the objection simply stays accepted.
    expect(revisionProblem(before, { keepPosition: true, content: before, changes: [] }, [{ id: "obj_2", conceded: false, status: "accepted" }])).toBeNull();
  });
});
