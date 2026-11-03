import { describe, expect, it } from "vitest";
import { REFERENCE_CASES, type ReferenceCase } from "./reference-cases";
import { classifyReport, scoreRun, summarize, summaryToMarkdown, type ScoredReport } from "./reference-score";

const report = (outcome: string | null, extra: Partial<ScoredReport> = {}): ScoredReport =>
  ({ outcome, requirementsConflict: false, decisionFormat: { approvable: true }, tokens: { used: 1000, budget: 0 }, ...extra }) as ScoredReport;
const solvable = { id: "s", kind: "solvable", correct: ["recommended"], reviewed: true } as ReferenceCase;
const blocked = { id: "b", kind: "contradictory", correct: ["no_qualifying_solution", "requirements_conflict"], reviewed: true } as ReferenceCase;

describe("reference set (#182)", () => {
  it("has unique ids, a label and a rationale for every case and covers solvable and blocked briefs", () => {
    expect(new Set(REFERENCE_CASES.map((c) => c.id)).size).toBe(REFERENCE_CASES.length);
    for (const c of REFERENCE_CASES) {
      expect(c.correct.length).toBeGreaterThan(0);
      expect(c.rationale.length).toBeGreaterThan(20);
      expect(c.brief.requirements.length).toBeGreaterThan(0);
    }
    expect(REFERENCE_CASES.filter((c) => c.correct.includes("recommended")).length).toBeGreaterThanOrEqual(5);
    expect(REFERENCE_CASES.filter((c) => !c.correct.includes("recommended")).length).toBeGreaterThanOrEqual(5);
  });

  it("does not count a recommendation that cannot be approved as one", () => {
    expect(classifyReport(report("recommended", { decisionFormat: { approvable: false } }))).toBe("needs_verification");
    expect(classifyReport(report("no_qualifying_solution", { requirementsConflict: true }))).toBe("requirements_conflict");
    expect(classifyReport(report(null))).toBe("no_verdict");
  });

  it("separates false approvals from unnecessary blocks", () => {
    expect(scoreRun(blocked, report("recommended")).result).toBe("false_approval");
    expect(scoreRun(solvable, report("no_qualifying_solution")).result).toBe("unnecessary_block");
    expect(scoreRun(solvable, report("needs_verification")).result).toBe("unnecessary_block");
    expect(scoreRun(solvable, report("tie")).result).toBe("correct");
    expect(scoreRun(blocked, report("tie")).result).toBe("wrong");
    expect(scoreRun(blocked, report(null)).result).toBe("failed_run");
  });

  it("counts a correct rejection as useful and leaves draft labels out of every rate", () => {
    const draft = { ...solvable, id: "d", reviewed: false };
    const [s] = summarize(
      [
        { caseId: "s", config: "A", file: "1", report: report("recommended") },
        { caseId: "b", config: "A", file: "2", report: report("no_qualifying_solution") },
        { caseId: "b", config: "A", file: "3", report: report("recommended") },
        { caseId: "d", config: "A", file: "4", report: report("no_qualifying_solution") },
      ],
      [solvable, blocked, draft],
    );
    expect(s).toMatchObject({ runs: 4, reviewedRuns: 3, correct: 2, falseApprovals: 1, notSolvableRuns: 2, unnecessaryBlocks: 0, tokensPerCorrect: 1500 });
    expect(summaryToMarkdown([s!])).toContain("Not counted – label not yet reviewed by a human: A/d");
  });

  it("rejects a report for an unknown case", () => {
    expect(() => summarize([{ caseId: "x", config: "A", file: "x.json", report: report("recommended") }], [solvable])).toThrow(/unknown reference case/);
  });
});
