import { describe, expect, it } from "vitest";
import type { CheckStatus, GateInput, RawRequirementCheck } from "../contract";
import { evaluateGate } from "./gate";

const DRAFT = { architecture: "Two services on one VM", components: ["api", "db"], solvesRequirements: true };
const ALL = ["e1", "e2", "e3", "e4", "e5", "e6"];

function check(evaluator: string, requirementId: string, status: CheckStatus, extra: Partial<RawRequirementCheck> = {}): RawRequirementCheck {
  return {
    evaluatorParticipantId: evaluator,
    proposalId: "A",
    requirementId,
    status,
    allPartsMet: status === "PASS" ? true : false,
    evidence: `${status} because of section X`,
    valid: true,
    revisionId: "A1",
    estimate: null,
    ...extra,
  };
}

/** Proposal A by e6, evaluated by e1–e5 (n = 5), unless overridden. */
function input(
  checks: RawRequirementCheck[],
  options: {
    requirements?: string[];
    content?: unknown;
    delivered?: string[];
    extra?: GateInput["round"]["proposals"];
    measures?: GateInput["round"]["measures"];
  } = {},
): GateInput {
  return {
    round: {
      requirementIds: options.requirements ?? ["R1"],
      ...(options.measures ? { measures: options.measures } : {}),
      proposals: [
        {
          proposalId: "A",
          revisionId: "A1",
          authorParticipantId: "e6",
          expectedEvaluatorIds: ["e1", "e2", "e3", "e4", "e5"],
          content: options.content ?? DRAFT,
        },
        ...(options.extra ?? []),
      ],
    },
    checks,
    deliveredEvaluatorIds: options.delivered ?? ALL,
  };
}

const passes = (ids: string[], r = "R1") => ids.map((id) => check(id, r, "PASS"));
const result = (i: GateInput, id = "A") => evaluateGate(i).proposals.find((p) => p.proposalId === id)!;

describe("S1 gate: requirement status (R1)", () => {
  it("all expected evaluators PASS -> PASS -> qualified", () => {
    const r = result(input(passes(["e1", "e2", "e3", "e4", "e5"])));
    expect(r.requirements[0]!.status).toBe("PASS");
    expect(r.feasibility).toBe("qualified");
    expect(r.causes).toEqual([]);
  });

  it("R7.1: 5 PASS expected, one check missing -> UNKNOWN -> needs_verification", () => {
    const r = result(input(passes(["e1", "e2", "e3", "e4"])));
    expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", open: ["e5"] });
    expect(r.feasibility).toBe("needs_verification");
  });

  it("live test #181: the cause names 'could not confirm' and 'no valid answer' separately", () => {
    const unknownOnly = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "UNKNOWN")]));
    expect(unknownOnly.causes).toEqual(["R1 not confirmed: 1 of 5 evaluators could not confirm it."]);
    const openOnly = result(input(passes(["e1", "e2", "e3", "e4"])));
    expect(openOnly.causes).toEqual(["R1 not confirmed: 1 of 5 evaluators gave no valid answer."]);
    const both = result(input([...passes(["e1", "e2", "e3"]), check("e4", "R1", "UNKNOWN")]));
    expect(both.causes).toEqual(["R1 not confirmed: 1 of 5 evaluators could not confirm it; 1 of 5 evaluators gave no valid answer."]);
  });

  it("review A: explicit UNKNOWN with long evidence stays open", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "UNKNOWN", { evidence: "A current price quote is missing; ".repeat(10) })]));
    expect(r.requirements[0]!.status).toBe("UNKNOWN");
    expect(r.feasibility).toBe("needs_verification");
  });

  it("owner rule 4: PASS without the statement that every part is met counts as UNKNOWN", () => {
    for (const allPartsMet of [false, null]) {
      const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "PASS", { allPartsMet })]));
      expect(r.requirements[0]!.status).toBe("UNKNOWN");
      expect(r.feasibility).toBe("needs_verification");
    }
  });

  it("PASS with empty evidence counts as UNKNOWN", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "PASS", { evidence: "   " })]));
    expect(r.requirements[0]!.status).toBe("UNKNOWN");
  });

  it("FAIL against a PASS majority -> DISPUTED, never buildable", () => {
    const r = result(input([...passes(["e1", "e2", "e3"]), check("e4", "R1", "FAIL")]));
    expect(r.requirements[0]!.status).toBe("DISPUTED");
    expect(r.feasibility).toBe("needs_verification");
  });

  it("FAIL without a PASS majority -> FAIL -> fail", () => {
    const r = result(input([...passes(["e1", "e2"]), check("e3", "R1", "FAIL")]));
    expect(r.requirements[0]!.status).toBe("FAIL");
    expect(r.feasibility).toBe("fail");
    expect(r.causes.join(" ")).toMatch(/model judgement/);
  });

  it("R7.3: 2 PASS + 1 FAIL (n = 3) is DISPUTED; an extra PASS of the third evaluator keeps it locked and the conflict visible", () => {
    const three = (checks: RawRequirementCheck[]) => ({
      round: {
        requirementIds: ["R1"],
        proposals: [{ proposalId: "A", revisionId: "A1", authorParticipantId: "e4", expectedEvaluatorIds: ["e1", "e2", "e3"], content: DRAFT }],
      },
      checks,
      deliveredEvaluatorIds: ["e1", "e2", "e3", "e4"],
    });
    const base = [...passes(["e1", "e2"]), check("e3", "R1", "FAIL")];
    expect(result(three(base)).requirements[0]!.status).toBe("DISPUTED");
    const withPass = result(three([...base, check("e3", "R1", "PASS")]));
    expect(withPass.requirements[0]).toMatchObject({ status: "DISPUTED", fail: ["e3"], conflicts: ["e3"] });
    expect(withPass.feasibility).not.toBe("qualified");
  });
});

describe("S1 gate: negative evidence and duplicates (R2)", () => {
  it("PASS and FAIL by the same evaluator count as FAIL plus conflict; the PASS does not count", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "PASS"), check("e5", "R1", "FAIL")]));
    expect(r.requirements[0]).toMatchObject({ status: "DISPUTED", fail: ["e5"], conflicts: ["e5"] });
    expect(r.requirements[0]!.pass).not.toContain("e5");
  });

  it("owner rule 4: a full PASS next to a partial PASS of the same evaluator is not a PASS", () => {
    for (const partial of [{ allPartsMet: false }, { evidence: " " }]) {
      const r = result(input([...passes(["e1", "e2", "e3", "e4", "e5"]), check("e5", "R1", "PASS", partial)]));
      expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", unknown: ["e5"] });
      expect(r.feasibility).toBe("needs_verification");
    }
  });

  it("R7.4: same status with two pieces of evidence counts once", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4", "e5"]), check("e1", "R1", "PASS", { evidence: "second reason" })]));
    expect(r.requirements[0]).toMatchObject({ status: "PASS", pass: ["e1", "e2", "e3", "e4", "e5"] });
  });

  it("R7.5: two whole evaluations of the same evaluator never lose a FAIL", () => {
    const first = [check("e1", "R1", "FAIL"), check("e1", "R2", "PASS")];
    const second = [check("e1", "R1", "PASS"), check("e1", "R2", "PASS")];
    const r = result(
      input([...first, ...second, ...passes(["e2", "e3", "e4", "e5"]), ...passes(["e2", "e3", "e4", "e5"], "R2")], { requirements: ["R1", "R2"] }),
    );
    expect(r.requirements.find((x) => x.requirementId === "R1")).toMatchObject({ fail: ["e1"], conflicts: ["e1"] });
    expect(r.feasibility).not.toBe("qualified");
  });

  it("R7(c): order and exact duplicates change neither feasibility nor causes", () => {
    const checks = [...passes(["e1", "e2", "e3"]), check("e4", "R1", "FAIL"), check("e5", "R1", "UNKNOWN")];
    const a = result(input(checks));
    const b = result(input([...checks].reverse().concat(checks)));
    expect(b.feasibility).toBe(a.feasibility);
    expect(b.causes).toEqual(a.causes);
    expect(b.requirements[0]!.status).toBe(a.requirements[0]!.status);
  });

  it("R7.10: checks bound to another proposal, an unknown requirement or marked invalid never count", () => {
    const r = result(
      input([
        ...passes(["e1", "e2", "e3", "e4"]),
        check("e5", "R1", "PASS", { proposalId: "B" }),
        check("e5", "R9", "PASS"),
        check("e5", "R1", "PASS", { valid: false }),
      ]),
    );
    expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", open: ["e5"] });
  });

  it("the author never counts as an evaluator of its own proposal, even if listed", () => {
    const i = input([...passes(["e1", "e2", "e3", "e4"]), check("e6", "R1", "PASS")]);
    i.round.proposals[0]!.expectedEvaluatorIds.push("e6");
    expect(result(i).requirements[0]!.status).toBe("UNKNOWN");
  });
});

describe("S1 gate: proposal feasibility (R3)", () => {
  it("R7.8: formally valid JSON with an empty architecture or no components is incomplete", () => {
    for (const content of [
      { ...DRAFT, architecture: "  " },
      { ...DRAFT, components: [] },
      { ...DRAFT, components: [" "] },
    ]) {
      const r = result(input(passes(["e1", "e2", "e3", "e4", "e5"]), { content }));
      expect(r.feasibility).toBe("incomplete");
    }
  });

  it("R7.7: author says unsolvable, evaluators UNKNOWN -> needs_verification, not fail", () => {
    const r = result(input([check("e1", "R1", "UNKNOWN")], { content: { ...DRAFT, solvesRequirements: false } }));
    expect(r.feasibility).toBe("needs_verification");
    expect(r.causes.join(" ")).toMatch(/author states/);
  });

  it("#181 core: the author's honest 'does not solve' is no veto when every evaluator confirmed every requirement", () => {
    const r = result(input(passes(["e1", "e2", "e3", "e4", "e5"]), { content: { ...DRAFT, solvesRequirements: false } }));
    expect(r.feasibility).toBe("qualified");
    // And the other way round: the author's 'solves' does not outweigh an independent FAIL.
    const f = result(input([...passes(["e1"]), check("e2", "R1", "FAIL")], { content: { ...DRAFT, solvesRequirements: true } }));
    expect(f.feasibility).toBe("fail");
  });

  it("checks for another revision than the frozen one never count (fail closed)", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "PASS", { revisionId: "A0" })]));
    expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", open: ["e5"] });
  });

  it("fail takes precedence over open requirements", () => {
    const r = result(input([...passes(["e1"]), check("e2", "R1", "FAIL"), ...passes(["e1", "e2", "e3"], "R2")], { requirements: ["R1", "R2"] }));
    expect(r.feasibility).toBe("fail");
  });

  it("no expected evaluator -> never qualified", () => {
    const i = input([]);
    i.round.proposals[0]!.expectedEvaluatorIds = [];
    expect(result(i).feasibility).toBe("needs_verification");
  });

  it("R7(a): removing positive evidence never makes a proposal qualified", () => {
    const full = [...passes(["e1", "e2", "e3", "e4", "e5"]), ...passes(["e1", "e2", "e3", "e4", "e5"], "R2")];
    expect(result(input(full, { requirements: ["R1", "R2"] })).feasibility).toBe("qualified");
    for (let i = 0; i < full.length; i++) {
      const fewer = full.filter((_, j) => j !== i);
      expect(result(input(fewer, { requirements: ["R1", "R2"] })).feasibility).not.toBe("qualified");
    }
  });

  it("#230: the summary tells 'not confirmed' apart from 'not met' – a lost evaluation is no unmet requirement", () => {
    // Every check PASS, but e5 delivered nothing: not confirmed, nothing unmet.
    const open = evaluateGate(input(passes(["e1", "e2", "e3", "e4"])));
    expect(open.proposals[0]!.feasibility).toBe("needs_verification");
    expect(open.summary).toBe(
      "None of the 1 evaluated proposals could be confirmed against all requirements: the evaluations leave requirements open. Not confirmed is not the same as not met.",
    );
    expect(open.summary).not.toMatch(/meets? all confirmed requirements/);
  });

  it("review C: never claims that the requirements cannot be met together, also when every proposal fails", () => {
    const g = evaluateGate(input([check("e1", "R1", "FAIL"), check("e2", "R1", "FAIL"), check("e3", "R1", "FAIL")]));
    expect(g.proposals[0]!.feasibility).toBe("fail");
    expect(g.summary).toBe("None of the evaluated proposals meets all confirmed requirements according to these evaluations.");
    const text = [g.summary, ...g.proposals.flatMap((p) => p.causes)].join(" ");
    expect(text).not.toMatch(/cannot be met together|unsolvable|impossible|unlösbar/i);
  });
});

describe("S1 gate: conflict-of-interest signal", () => {
  it("names the single evaluator whose statements alone block a proposal", () => {
    const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "UNKNOWN")]));
    expect(r.soleBlocker).toBe("e5");
  });

  it("no sole blocker when two evaluators object, a check is open or the proposal is qualified", () => {
    expect(result(input([...passes(["e1", "e2", "e3"]), check("e4", "R1", "UNKNOWN"), check("e5", "R1", "FAIL")])).soleBlocker).toBeNull();
    expect(result(input(passes(["e1", "e2", "e3", "e4"]))).soleBlocker).toBeNull();
    expect(result(input(passes(["e1", "e2", "e3", "e4", "e5"]))).soleBlocker).toBeNull();
  });

  it("#181 core: the author's 'does not solve' never switches the protection against a competitor's sole veto off", () => {
    for (const status of ["UNKNOWN", "FAIL"] as const) {
      const r = result(input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", status)], { content: { ...DRAFT, solvesRequirements: false } }));
      expect(r.soleBlocker).toBe("e5");
    }
  });
});

describe("S1 gate: comparison on equal terms (review §3)", () => {
  // A by e1 and B by e2; e1 fails as an evaluator: A loses nothing (e1 is its author), B misses e1.
  const two = (delivered: string[], checks: RawRequirementCheck[]): GateInput => ({
    round: {
      requirementIds: ["R1"],
      proposals: [
        { proposalId: "A", revisionId: "A1", authorParticipantId: "e1", expectedEvaluatorIds: ["e2", "e3"], content: DRAFT },
        { proposalId: "B", revisionId: "B1", authorParticipantId: "e2", expectedEvaluatorIds: ["e1", "e3"], content: DRAFT },
      ],
    },
    checks,
    deliveredEvaluatorIds: delivered,
  });

  it("the failed evaluator's own proposal can be qualified, but there is no automatic winner", () => {
    const g = evaluateGate(
      two(["e2", "e3"], [check("e2", "R1", "PASS"), check("e3", "R1", "PASS"), check("e3", "R1", "PASS", { proposalId: "B", revisionId: "B1" })]),
    );
    expect(g.proposals.find((p) => p.proposalId === "A")!.feasibility).toBe("qualified");
    expect(g.proposals.find((p) => p.proposalId === "B")!.feasibility).toBe("needs_verification");
    expect(g.comparisonComplete).toBe(false);
    expect(g.comparisonNote).toMatch(/No automatic recommendation/);
  });

  it("a missing evaluator of a proposal excluded by FAIL does not block the comparison", () => {
    const g = evaluateGate(
      two(["e2", "e3"], [check("e2", "R1", "PASS"), check("e3", "R1", "PASS"), check("e3", "R1", "FAIL", { proposalId: "B", revisionId: "B1" })]),
    );
    expect(g.proposals.find((p) => p.proposalId === "B")!.feasibility).toBe("fail");
    expect(g.comparisonComplete).toBe(true);
  });

  it("an evaluator that delivered but left out the checks for one proposal makes the comparison incomplete", () => {
    // e1 evaluated nothing of B (checks left out), although it delivered a vote: B's best case would be qualified.
    const g = evaluateGate(
      two(["e1", "e2", "e3"], [check("e2", "R1", "PASS"), check("e3", "R1", "PASS"), check("e3", "R1", "PASS", { proposalId: "B", revisionId: "B1" })]),
    );
    expect(g.proposals.find((p) => p.proposalId === "B")!.feasibility).toBe("needs_verification");
    expect(g.comparisonComplete).toBe(false);
    expect(g.comparisonNote).toMatch(/left checks out/);
  });

  it("left-out checks on a proposal that fails anyway do not block the comparison", () => {
    const g = evaluateGate(
      two(["e1", "e2", "e3"], [check("e2", "R1", "PASS"), check("e3", "R1", "PASS"), check("e3", "R1", "FAIL", { proposalId: "B", revisionId: "B1" })]),
    );
    expect(g.proposals.find((p) => p.proposalId === "B")!.feasibility).toBe("fail");
    expect(g.comparisonComplete).toBe(true);
  });

  it("left-out checks that could lift a FAIL to DISPUTED make the comparison incomplete (no unfounded 'no solution')", () => {
    // n = 5: 2 PASS, 1 FAIL, 2 open. Given, the open checks would be a PASS majority -> DISPUTED instead of FAIL.
    const g = evaluateGate(input([...passes(["e1", "e2"]), check("e3", "R1", "FAIL")]));
    expect(g.proposals[0]!.feasibility).toBe("fail");
    expect(g.comparisonComplete).toBe(false);
  });

  it("R7.2: an evaluator failing after the start keeps n: no release for the proposals it should have checked", () => {
    const r = result(input(passes(["e1", "e2", "e3", "e4"]), { delivered: ["e1", "e2", "e3", "e4", "e6"] }));
    expect(r.feasibility).toBe("needs_verification");
    expect(evaluateGate(input(passes(["e1", "e2", "e3", "e4"]), { delivered: ["e1", "e2", "e3", "e4", "e6"] })).comparisonComplete).toBe(false);
  });
});

describe("measured requirements (contract 3): estimates decide, strictly", () => {
  const months = { R1: { direction: "max" as const, value: 4, unit: "months" } };
  const est = (evaluator: string, low: number, high: number, status: CheckStatus = "UNKNOWN") =>
    check(evaluator, "R1", status, { estimate: { low, high }, evidence: "Setup 1, core 2, tests 1", allPartsMet: false });
  const five = ["e1", "e2", "e3", "e4", "e5"];

  it("every range at or below the limit -> PASS, even if the models themselves only said UNKNOWN", () => {
    const r = result(input([est("e1", 3, 4), est("e2", 3, 3.5), est("e3", 2.5, 4), est("e4", 3, 4), est("e5", 3.5, 4)], { measures: months }));
    expect(r.requirements[0]).toMatchObject({ status: "PASS", estimate: { low: 2.5, high: 4, median: 3.5, evaluators: 5, limit: months.R1 } });
    expect(r.feasibility).toBe("qualified");
  });

  it("one range across the limit -> UNKNOWN with the numbers in the cause", () => {
    const r = result(input([...["e1", "e2", "e3", "e4"].map((e) => est(e, 3, 4)), est("e5", 3.5, 5)], { measures: months }));
    expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", unknown: ["e5"] });
    expect(r.feasibility).toBe("needs_verification");
    expect(r.causes).toEqual([
      "R1 not confirmed: estimates 3–5 months (median 3.5), limit at most 4 months; 1 of 5 evaluators' ranges reach across the limit (model estimates).",
    ]);
  });

  it("all ranges above the limit -> FAIL", () => {
    const r = result(
      input(
        five.map((e) => est(e, 5, 7)),
        { measures: months },
      ),
    );
    expect(r.requirements[0]!.status).toBe("FAIL");
    expect(r.feasibility).toBe("fail");
    expect(r.causes[0]).toMatch(/^R1 not met: estimates 5–7 months \(median 6\), limit at most 4 months; 5 of 5 evaluators expect the limit to be missed/);
  });

  it("a model's own FAIL stays FAIL even with an estimate inside the limit; a PASS without estimate or with a broken one is UNKNOWN", () => {
    const fail = result(input([...["e1", "e2", "e3", "e4"].map((e) => est(e, 3, 4)), est("e5", 3, 4, "FAIL")], { measures: months }));
    expect(fail.requirements[0]).toMatchObject({ status: "DISPUTED", fail: ["e5"] });
    const noEstimate = result(input([...["e1", "e2", "e3", "e4"].map((e) => est(e, 3, 4)), check("e5", "R1", "PASS")], { measures: months }));
    expect(noEstimate.requirements[0]).toMatchObject({ status: "UNKNOWN", unknown: ["e5"] });
    const broken = result(input([...["e1", "e2", "e3", "e4"].map((e) => est(e, 3, 4)), est("e5", -1, 3, "PASS")], { measures: months }));
    expect(broken.requirements[0]).toMatchObject({ status: "UNKNOWN", unknown: ["e5"] });
    expect(broken.requirements[0]!.estimate).toMatchObject({ evaluators: 4 });
  });

  it("test cases 30.10.26: exact numbers (never 99.95 -> 100) and 'no usable estimate' named apart from 'across the limit'", () => {
    const availability = { R1: { direction: "min" as const, value: 99.9, unit: "%" } };
    const r = result(
      input([...["e1", "e2", "e3"].map((e) => est(e, 99.9, 99.95)), est("e4", 99.85, 99.95), check("e5", "R1", "PASS")], { measures: availability }),
    );
    expect(r.requirements[0]).toMatchObject({ status: "UNKNOWN", estimate: { straddling: 1, withoutEstimate: 1 } });
    expect(r.causes[0]).toBe(
      "R1 not confirmed: estimates 99.85–99.95 % (median 99.925), limit at least 99.9 %; 1 of 5 evaluators' ranges reach across the limit; 1 of 5 evaluators gave no usable estimate (model estimates).",
    );
  });

  it("test case 30.10.26: a reversed range (best case 99.9 as low, worst 99.3 as high) is read as 99.3–99.9", () => {
    const availability = { R1: { direction: "min" as const, value: 99, unit: "%" } };
    const r = result(input([...["e1", "e2", "e3", "e4"].map((e) => est(e, 99.2, 99.8)), est("e5", 99.9, 99.3)], { measures: availability }));
    expect(r.requirements[0]).toMatchObject({ status: "PASS", estimate: { low: 99.2, high: 99.9, evaluators: 5 } });
    expect(r.feasibility).toBe("qualified");
  });

  it("#226: a strict limit excludes its value – 'below 150' is missed by a range that reaches 150", () => {
    const below = { R1: { direction: "max" as const, value: 150, unit: "EUR/month", strict: true } };
    const atLimit = result(
      input(
        five.map((e) => est(e, 100, 150)),
        { measures: below },
      ),
    );
    expect(atLimit.requirements[0]!.status).toBe("UNKNOWN");
    expect(atLimit.causes[0]).toMatch(/limit below 150 EUR per month; 5 of 5 evaluators' ranges reach across the limit/);
    expect(
      result(
        input(
          five.map((e) => est(e, 150, 160)),
          { measures: below },
        ),
      ).requirements[0]!.status,
    ).toBe("FAIL");
    expect(
      result(
        input(
          five.map((e) => est(e, 100, 149.99)),
          { measures: below },
        ),
      ).requirements[0]!.status,
    ).toBe("PASS");
    // Inclusive (no strict): 150 keeps "at most 150".
    expect(
      result(
        input(
          five.map((e) => est(e, 100, 150)),
          { measures: { R1: { ...below.R1, strict: undefined } } },
        ),
      ).requirements[0]!.status,
    ).toBe("PASS");
    const above = { R1: { direction: "min" as const, value: 99.9, unit: "%", strict: true } };
    expect(
      result(
        input(
          five.map((e) => est(e, 99.9, 99.95)),
          { measures: above },
        ),
      ).requirements[0]!.status,
    ).toBe("UNKNOWN");
    expect(
      result(
        input(
          five.map((e) => est(e, 99.8, 99.9)),
          { measures: above },
        ),
      ).requirements[0]!.status,
    ).toBe("FAIL");
  });

  it("#226: numbers are shown as given – 150.004 is not '150', 99.949 not '99.94'", () => {
    const max = { R1: { direction: "max" as const, value: 150, unit: "EUR/month" } };
    expect(
      result(
        input(
          five.map((e) => est(e, 120, 150.004)),
          { measures: max },
        ),
      ).causes[0],
    ).toMatch(/^R1 not confirmed: estimates 120–150.004 EUR per month/);
    const min = { R1: { direction: "min" as const, value: 99.95, unit: "%" } };
    expect(
      result(
        input(
          five.map((e) => est(e, 99.9, 99.949)),
          { measures: min },
        ),
      ).causes[0],
    ).toMatch(/^R1 not met: estimates 99.9–99.949 % \(median 99.9245\)/);
  });

  it("a minimum (availability) mirrors the rule", () => {
    const availability = { R1: { direction: "min" as const, value: 99.5, unit: "%" } };
    expect(
      result(
        input(
          five.map((e) => est(e, 99.5, 99.9)),
          { measures: availability },
        ),
      ).requirements[0]!.status,
    ).toBe("PASS");
    expect(
      result(
        input(
          five.map((e) => est(e, 98, 99.4)),
          { measures: availability },
        ),
      ).requirements[0]!.status,
    ).toBe("FAIL");
    expect(
      result(
        input(
          five.map((e) => est(e, 99, 99.9)),
          { measures: availability },
        ),
      ).requirements[0]!.status,
    ).toBe("UNKNOWN");
  });

  it("without measures nothing changes: an estimate on an unmeasured requirement is ignored", () => {
    const r = result(input(five.map((e) => est(e, 5, 7, "PASS")).map((c) => ({ ...c, allPartsMet: true }))));
    expect(r.requirements[0]).toMatchObject({ status: "PASS" });
    expect(r.requirements[0]!.estimate).toBeUndefined();
  });
});

describe("S1 gate: minimum review breadth (#249)", () => {
  // Self-improvement council 30.10.26: one model dropped out in the first phase, so each proposal kept one evaluator.
  const single = (checks: RawRequirementCheck[]): GateInput => ({
    round: {
      requirementIds: ["R1", "R2"],
      proposals: [
        { proposalId: "A", revisionId: "A1", authorParticipantId: "e1", expectedEvaluatorIds: ["e2"], content: DRAFT },
        { proposalId: "B", revisionId: "B1", authorParticipantId: "e2", expectedEvaluatorIds: ["e1"], content: DRAFT },
      ],
    },
    checks,
    deliveredEvaluatorIds: ["e1", "e2"],
  });
  const on = (proposalId: string, revisionId: string, evaluator: string, r: string, status: CheckStatus) => ({
    ...check(evaluator, r, status),
    proposalId,
    revisionId,
  });

  it("one evaluator confirming everything is a provisional favourite, never qualified", () => {
    const gate = evaluateGate(single([on("B", "B1", "e1", "R1", "PASS"), on("B", "B1", "e1", "R2", "PASS")]));
    const b = gate.proposals.find((p) => p.proposalId === "B")!;
    expect(b.feasibility).toBe("needs_verification");
    expect(b.limitedReview).toBe(true);
    expect(b.causes.join(" ")).toMatch(/Limited review: only 1 independent evaluator .* at least 2/);
    expect(gate.proposals.some((p) => p.feasibility === "qualified")).toBe(false);
    expect(gate.summary).toMatch(
      /^1 proposal passed every check, but too few independent evaluators took part .* a provisional favourite, not a recommendation\./,
    );
  });

  it("the summary speaks about the other proposals separately", () => {
    const gate = evaluateGate(single([on("B", "B1", "e1", "R1", "PASS"), on("B", "B1", "e1", "R2", "PASS"), on("A", "A1", "e2", "R1", "UNKNOWN")]));
    expect(gate.summary).toMatch(/provisional favourite, not a recommendation\. None of the 1 other evaluated proposals could be confirmed/);
  });

  it("a FAIL or UNKNOWN stays what it is – limited review only marks a proposal that passed every check", () => {
    const gate = evaluateGate(
      single([on("A", "A1", "e2", "R1", "FAIL"), on("A", "A1", "e2", "R2", "PASS"), on("B", "B1", "e1", "R1", "UNKNOWN"), on("B", "B1", "e1", "R2", "PASS")]),
    );
    const [a, b] = ["A", "B"].map((id) => gate.proposals.find((p) => p.proposalId === id)!);
    expect(a!.feasibility).toBe("fail");
    expect(b!.feasibility).toBe("needs_verification");
    expect(a!.limitedReview).toBe(false);
    expect(b!.limitedReview).toBe(false);
  });

  it("two independent evaluators confirming everything qualify as before", () => {
    const i = input([...passes(["e1", "e2"])]);
    i.round.proposals[0]!.expectedEvaluatorIds = ["e1", "e2"];
    const a = result(i);
    expect(a.feasibility).toBe("qualified");
    expect(a.limitedReview).toBe(false);
    expect(a.causes).toEqual([]);
  });
});

describe("build checks (night test R4)", () => {
  it("a planned build check qualifies but stays marked; no plan still blocks", () => {
    const planned = evaluateGate({ ...input(passes(["e1", "e2", "e3", "e4", "e5"])), round: { ...input([]).round, buildChecks: ["R1"] } }).proposals[0]!;
    expect(planned.feasibility).toBe("qualified");
    expect(planned.requirements[0]).toMatchObject({ status: "PASS", buildVerification: true });
    const noPlan = evaluateGate({
      ...input([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "UNKNOWN")]),
      round: { ...input([]).round, buildChecks: ["R1"] },
    }).proposals[0]!;
    expect(noPlan.feasibility).toBe("needs_verification");
    expect(noPlan.requirements[0]!.buildVerification).toBe(true);
    // Without buildChecks nothing changes.
    expect(result(input(passes(["e1", "e2", "e3", "e4", "e5"]))).requirements[0]!.buildVerification).toBeUndefined();
  });
});

describe("measurement checks (#249 part 2, contract 5)", () => {
  // OnJam R5 "muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen": only measuring the running system proves it.
  const FIVE = ["e1", "e2", "e3", "e4", "e5"];
  const withMeasurement = (checks: RawRequirementCheck[], requirements = ["R1"], measurementChecks = ["R1"]): GateInput => {
    const base = input(checks, { requirements });
    return { ...base, round: { ...base.round, measurementChecks } };
  };

  it("a confirmed measurement plan makes an architecture candidate – never qualified", () => {
    const gate = evaluateGate(withMeasurement([...passes(FIVE, "R1"), ...passes(FIVE, "R2")], ["R1", "R2"], ["R2"]));
    const a = gate.proposals[0]!;
    expect(a.feasibility).toBe("needs_verification");
    expect(a.architectureCandidate).toBe(true);
    expect(a.limitedReview).toBe(false);
    expect(a.requirements.find((r) => r.requirementId === "R2")).toMatchObject({ status: "PASS", measurementPending: true });
    expect(a.requirements.find((r) => r.requirementId === "R1")!.measurementPending).toBeUndefined();
    expect(a.causes.join(" ")).toMatch(/Architecture candidate – performance proof open: R2 can only be confirmed by measuring/);
    expect(a.soleBlocker).toBeNull();
    expect(gate.comparisonComplete).toBe(true);
    expect(gate.summary).toMatch(/^1 proposal passed every check, but a requirement can only be confirmed by measuring .* an architecture candidate/);
  });

  it("no plan, a FAIL or a dispute stays what it is – the candidate mark needs every check passed", () => {
    const noPlan = result(withMeasurement([...passes(["e1", "e2", "e3", "e4"]), check("e5", "R1", "UNKNOWN")]));
    expect(noPlan.feasibility).toBe("needs_verification");
    expect(noPlan.architectureCandidate).toBe(false);
    expect(noPlan.requirements[0]!.measurementPending).toBe(true);
    const failed = result(withMeasurement([...passes(["e1", "e2"]), ...["e3", "e4", "e5"].map((e) => check(e, "R1", "FAIL"))]));
    expect(failed.feasibility).toBe("fail");
    expect(failed.architectureCandidate).toBe(false);
  });

  it("below the minimum review breadth it is a provisional favourite, not an architecture candidate", () => {
    const i = withMeasurement([check("e1", "R1", "PASS")]);
    i.round.proposals[0]!.expectedEvaluatorIds = ["e1"];
    const a = result(i);
    expect(a.feasibility).toBe("needs_verification");
    expect(a.limitedReview).toBe(true);
    expect(a.architectureCandidate).toBe(false);
  });

  it("a missing evaluator still makes the comparison incomplete", () => {
    const gate = evaluateGate(withMeasurement(passes(["e1", "e2", "e3", "e4"])));
    expect(gate.proposals[0]!.architectureCandidate).toBe(false);
    expect(gate.comparisonComplete).toBe(false);
  });

  it("gate version 2 rounds (no measurementChecks) are unchanged: qualified, no new fields", () => {
    const a = result(input(passes(FIVE)));
    expect(a.feasibility).toBe("qualified");
    expect(a.architectureCandidate).toBeUndefined();
    expect(a.requirements[0]!.measurementPending).toBeUndefined();
    expect(evaluateGate(input(passes(FIVE))).summary).toBeNull();
  });

  it("a qualified proposal next to an architecture candidate: the qualified one wins, no candidate summary", () => {
    const gate = evaluateGate(withMeasurement(passes(FIVE), ["R1"], []));
    expect(gate.proposals[0]!.feasibility).toBe("qualified");
    expect(gate.proposals[0]!.architectureCandidate).toBe(false);
  });
});

describe("independence groups (contract 6, owner decision 08.11.26: same model via several keys = ONE evaluator)", () => {
  const on = (proposalId: string, evaluator: string, r: string, status: CheckStatus) => ({
    ...check(evaluator, r, status),
    proposalId,
    revisionId: `${proposalId}1`,
  });
  const roundOf = (authors: Record<string, string>, groups: Record<string, string>, all: string[]): GateInput["round"] => ({
    requirementIds: ["R1"],
    participantGroups: groups,
    proposals: Object.entries(authors).map(([proposalId, author]) => ({
      proposalId,
      revisionId: `${proposalId}1`,
      authorParticipantId: author,
      expectedEvaluatorIds: all.filter((id) => id !== author),
      content: DRAFT,
    })),
  });

  it("3× Opus: an Opus author is never checked by Opus – no independent evaluator, never qualified", () => {
    const groups = { o1: "opus", o2: "opus", o3: "opus" };
    const gate = evaluateGate({
      round: roundOf({ A: "o1" }, groups, ["o1", "o2", "o3"]),
      checks: [on("A", "o2", "R1", "PASS"), on("A", "o3", "R1", "PASS")],
      deliveredEvaluatorIds: ["o1", "o2", "o3"],
    });
    const a = gate.proposals[0]!;
    expect(a.feasibility).toBe("needs_verification");
    expect(a.requirements[0]!.pass).toEqual([]);
    expect(a.causes.join(" ")).toMatch(/No independent evaluator was expected/);
  });

  it("3× Opus + GPT: a GPT proposal has one independent group – limited review, not qualified", () => {
    const groups = { o1: "opus", o2: "opus", o3: "opus", g: "gpt" };
    const checks = ["o1", "o2", "o3"].map((e) => on("B", e, "R1", "PASS"));
    const b = evaluateGate({ round: roundOf({ B: "g" }, groups, ["o1", "o2", "o3", "g"]), checks, deliveredEvaluatorIds: ["o1", "o2", "o3", "g"] })
      .proposals[0]!;
    expect(b.limitedReview).toBe(true);
    expect(b.feasibility).toBe("needs_verification");
    expect(b.causes.join(" ")).toMatch(/only 1 independent evaluator/);
  });

  it("an Opus proposal checked by GPT and Gemini counts n = 2 and qualifies; a second Opus key is not asked", () => {
    const groups = { o1: "opus", o2: "opus", g: "gpt", m: "gemini" };
    const checks = [on("A", "g", "R1", "PASS"), on("A", "m", "R1", "PASS")];
    const a = evaluateGate({ round: roundOf({ A: "o1" }, groups, ["o1", "o2", "g", "m"]), checks, deliveredEvaluatorIds: ["o1", "o2", "g", "m"] })
      .proposals[0]!;
    expect(a.feasibility).toBe("qualified");
    expect(a.requirements[0]!.open).toEqual([]);
  });

  it("instances of one group are judged together: one FAIL makes the group's statement FAIL", () => {
    const groups = { a: "author", o1: "opus", o2: "opus", g: "gpt" };
    const checks = [on("A", "o1", "R1", "PASS"), on("A", "o2", "R1", "FAIL"), on("A", "g", "R1", "PASS")];
    const r = evaluateGate({ round: roundOf({ A: "a" }, groups, ["a", "o1", "o2", "g"]), checks, deliveredEvaluatorIds: ["a", "o1", "o2", "g"] }).proposals[0]!;
    // Two groups: GPT PASS, Opus FAIL → PASS is no strict majority of 2 → FAIL.
    expect(r.requirements[0]).toMatchObject({ status: "FAIL", fail: ["o1", "o2"], pass: ["g"] });
    expect(r.causes.join(" ")).toMatch(/not met according to 1 of 2 evaluators/);
  });

  it("without participantGroups nothing changes", () => {
    expect(result(input(passes(["e1", "e2", "e3", "e4", "e5"]))).feasibility).toBe("qualified");
  });
});
