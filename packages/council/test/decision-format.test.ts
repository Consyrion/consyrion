import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_CANDIDATE_MESSAGE,
  assertCanEvaluateSession,
  assertDecisionApprovable,
  checkDecisionForApproval,
  decisionDisplayCheck,
  GATE_VERSION,
  MAX_SUPPORTED_GATE_VERSION,
} from "../src/decision-format";
import { NOT_IMPLEMENTABLE_MESSAGE } from "@consyrium/core";

const matrix = (proposals: unknown[], extra: Record<string, unknown> = {}) => ({ outcome: "recommended", recommendedProposalId: "A", proposals, ...extra });
const v1 = (overrides: Record<string, unknown> = {}) => ({
  gateVersion: 1,
  outcome: "recommended",
  recommendedProposalId: "A",
  matrix: matrix([
    { proposalId: "A", total: 8, implementable: true },
    { proposalId: "B", total: 7, implementable: false },
    { proposalId: "C", total: 6 },
  ]),
  ...overrides,
});

describe("decision format version (#181, stage 1)", () => {
  it("this release starts councils for gate version 3 and supports versions 1 to 3 (#181 S1, #249 part 2)", () => {
    expect(GATE_VERSION).toBe(3);
    expect(MAX_SUPPORTED_GATE_VERSION).toBe(3);
  });

  const gateEntry = (proposalId: string, feasibility: unknown, statuses: unknown[] = ["PASS", "PASS"]) => ({
    proposalId,
    feasibility,
    requirements: statuses.map((status, i) => ({ requirementId: `R${i + 1}`, status })),
  });
  const v2 = (feasibility: unknown, implementable: unknown, overrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    v1({
      gateVersion: 2,
      matrix: matrix([{ proposalId: "A", total: 8, implementable, securityBelowMinimum: false }], {
        roundId: "rnd_1",
        requirementIds: ["R1", "R2"],
        requirementGate: { proposals: [gateEntry("A", feasibility)], comparisonComplete: true },
        ...extra,
      }),
      ...overrides,
    });

  it("version 2 approves only a proposal the engine's gate marked qualified – nothing is assumed", () => {
    expect(checkDecisionForApproval(v2("qualified", true), "A")).toEqual({ ok: true });
    for (const feasibility of ["needs_verification", "fail", "incomplete", undefined, "QUALIFIED"])
      expect(checkDecisionForApproval(v2(feasibility, false), "A").ok, String(feasibility)).toBe(false);
    // Contradictions between the matrix row and the gate result are refused.
    expect(checkDecisionForApproval(v2("qualified", false), "A")).toMatchObject({ ok: false, reason: expect.stringMatching(/contradicts/) });
    expect(checkDecisionForApproval(v2("needs_verification", true), "A")).toMatchObject({ ok: false, reason: expect.stringMatching(/contradicts/) });
    // #249 review: a limited review is refused on its own – also when an engine result marks it qualified.
    const limited = (feasibility: string, implementable: boolean) =>
      v2(
        feasibility,
        implementable,
        {},
        { requirementGate: { proposals: [{ ...gateEntry("A", feasibility), limitedReview: true }], comparisonComplete: true } },
      );
    expect(checkDecisionForApproval(limited("qualified", true), "A")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/both qualified and limited review/),
    });
    expect(checkDecisionForApproval(limited("needs_verification", false), "A")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/provisional favourite/),
    });
    // Missing gate result, or the field missing on the row (the legacy "absent = approvable" rule never applies).
    expect(checkDecisionForApproval(v2("qualified", undefined), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1({ gateVersion: 2 }), "A")).toMatchObject({ ok: false, reason: expect.stringMatching(/no requirement gate result/) });
    // Never the "cannot be met together" wording of version 1.
    expect(JSON.stringify(checkDecisionForApproval(v2("fail", false), "A"))).not.toMatch(/cannot be met/);
    expect(decisionDisplayCheck(v2("qualified", true, { outcome: "needs_verification" })).ok).toBe(false);
  });

  it("#249 part 2 (gate version 3): an architecture candidate is never approvable, and an open measurement is never qualified", () => {
    const v3 = (entry: Record<string, unknown>, feasibility: string, implementable: boolean) =>
      v2(
        feasibility,
        implementable,
        { gateVersion: 3 },
        { requirementGate: { proposals: [{ ...gateEntry("A", feasibility), ...entry }], comparisonComplete: true } },
      );
    // A plain qualified version-3 entry is approvable like version 2.
    expect(checkDecisionForApproval(v3({}, "qualified", true), "A").ok).toBe(true);
    expect(checkDecisionForApproval(v3({ architectureCandidate: true }, "needs_verification", false), "A")).toMatchObject({
      ok: false,
      reason: ARCHITECTURE_CANDIDATE_MESSAGE,
    });
    // Contradictions in the stored entry are refused, whatever the engine wrote.
    expect(checkDecisionForApproval(v3({ architectureCandidate: true }, "qualified", true), "A")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/both qualified and with an open measurement/),
    });
    const pendingRequirement = {
      requirements: [
        { requirementId: "R1", status: "PASS" },
        { requirementId: "R2", status: "PASS", measurementPending: true },
      ],
    };
    expect(checkDecisionForApproval(v3(pendingRequirement, "qualified", true), "A")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/open measurement/),
    });
    // #511: the display reason of a needs-verification verdict names the candidate's open measurement.
    expect(decisionDisplayCheck({ ...v3({ architectureCandidate: true, ...pendingRequirement }, "needs_verification", false), outcome: "needs_verification" })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^Architecture candidate – performance proof open: R2 can only be confirmed by measuring/),
    });
    // Version 3 rests on the gate result exactly like version 2.
    expect(checkDecisionForApproval(v1({ gateVersion: 3 }), "A")).toMatchObject({ ok: false, reason: expect.stringMatching(/no requirement gate result/) });
  });

  it("version 2 refuses an internally inconsistent matrix (#181 review A)", () => {
    const bad = (extra: Record<string, unknown>) => checkDecisionForApproval(v2("qualified", true, {}, extra), "A");
    expect(bad({ roundId: undefined })).toMatchObject({ ok: false, reason: expect.stringMatching(/no frozen evaluation round/) });
    expect(bad({ requirementGate: { proposals: [gateEntry("A", "qualified"), gateEntry("A", "qualified")], comparisonComplete: true } }).ok).toBe(false);
    expect(bad({ requirementGate: { proposals: [], comparisonComplete: true } }).ok).toBe(false);
    expect(bad({ requirementGate: { proposals: [gateEntry("A", "qualified"), gateEntry("B", "qualified")], comparisonComplete: true } }).ok).toBe(false);
    expect(bad({ requirementIds: ["R1", "R2", "R3"] })).toMatchObject({ ok: false, reason: expect.stringMatching(/confirmed requirements/) });
    // "qualified" although a requirement is not PASS, and a recommendation without a complete comparison.
    expect(bad({ requirementGate: { proposals: [gateEntry("A", "qualified", ["PASS", "UNKNOWN"])], comparisonComplete: true } }).ok).toBe(false);
    expect(bad({ requirementGate: { proposals: [gateEntry("A", "qualified")], comparisonComplete: false } })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/complete comparison/),
    });
    // A caller that passes no matrix at all is refused, not waved through.
    expect(decisionDisplayCheck({ gateVersion: 2, outcome: "recommended" }).ok).toBe(false);
  });

  it("version 2 never approves a proposal below the security minimum, also not as an alternative (#181 review D)", () => {
    const below = v2("qualified", true, {
      matrix: matrix([{ proposalId: "A", total: 8, implementable: true, securityBelowMinimum: true }], {
        roundId: "rnd_1",
        requirementIds: ["R1", "R2"],
        requirementGate: { proposals: [gateEntry("A", "qualified")], comparisonComplete: true },
      }),
    });
    expect(checkDecisionForApproval(below, "A")).toMatchObject({ ok: false, reason: expect.stringMatching(/security minimum/) });
    // Missing flag: fail closed.
    const unknown = v2("qualified", true, {
      matrix: matrix([{ proposalId: "A", total: 8, implementable: true }], {
        roundId: "rnd_1",
        requirementIds: ["R1", "R2"],
        requirementGate: { proposals: [gateEntry("A", "qualified")], comparisonComplete: true },
      }),
    });
    expect(checkDecisionForApproval(unknown, "A").ok).toBe(false);
  });

  it("legacy version 1 keeps today's isImplementable rule", () => {
    expect(checkDecisionForApproval(v1(), "A")).toEqual({ ok: true });
    // Entries without the field (runs before #121) stay approvable, as in production e33a3bb.
    expect(checkDecisionForApproval(v1(), "C")).toEqual({ ok: true });
    expect(checkDecisionForApproval(v1(), "B")).toEqual({ ok: false, reason: NOT_IMPLEMENTABLE_MESSAGE });
    // Every outcome of the version-1 gate is readable (select_alternative works on tie / no_qualifying_solution).
    for (const outcome of ["tie", "no_qualifying_solution", "insufficient_evidence"])
      expect(
        checkDecisionForApproval(
          v1({ outcome, recommendedProposalId: null, matrix: matrix([{ proposalId: "A" }], { outcome, recommendedProposalId: null }) }),
          "A",
        ).ok,
      ).toBe(true);
  });

  it("refuses unknown, higher, missing and invalid versions", () => {
    for (const gateVersion of [4, 0, -1, 1.5, null, undefined]) {
      const check = checkDecisionForApproval(v1({ gateVersion }), "A");
      expect(check.ok, String(gateVersion)).toBe(false);
      expect(decisionDisplayCheck(v1({ gateVersion })).ok).toBe(false);
    }
    expect(() => assertDecisionApprovable(v1({ gateVersion: 4 }), "A")).toThrow(/gate version 4/);
    expect(() => assertDecisionApprovable(v1({ gateVersion: null }), "A")).toThrow(/no format version/);
  });

  it("needs_verification and unknown outcomes are never approvable", () => {
    for (const outcome of ["needs_verification", "qualified", ""]) {
      const decision = v1({ outcome, matrix: matrix([{ proposalId: "A", implementable: true }], { outcome }) });
      expect(checkDecisionForApproval(decision, "A").ok, outcome).toBe(false);
      expect(decisionDisplayCheck(decision).ok).toBe(false);
    }
    expect(decisionDisplayCheck(v1({ outcome: "needs_verification" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/^Needs verification/) });
  });

  it("refuses a missing matrix, a missing or duplicated entry and contradictory fields", () => {
    expect(checkDecisionForApproval(v1({ matrix: null }), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1({ matrix: {} }), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1({ matrix: { proposals: "A" } }), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1(), "Z")).toMatchObject({ ok: false, reason: expect.stringMatching(/not part of the stored verdict/) });
    expect(checkDecisionForApproval(v1({ matrix: matrix([{ proposalId: "A" }, { proposalId: "A" }]) }), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1({ matrix: matrix([{ proposalId: "A", implementable: "yes" }]) }), "A").ok).toBe(false);
    expect(checkDecisionForApproval(v1({ matrix: matrix([{ proposalId: "A" }], { outcome: "tie" }) }), "A")).toMatchObject({
      reason: expect.stringMatching(/outcome/),
    });
    expect(checkDecisionForApproval(v1({ matrix: matrix([{ proposalId: "A" }], { recommendedProposalId: "B" }) }), "A")).toMatchObject({
      reason: expect.stringMatching(/recommendation/),
    });
    // Older matrices without these keys are not contradictory.
    expect(checkDecisionForApproval(v1({ matrix: { proposals: [{ proposalId: "A" }] } }), "A").ok).toBe(true);
  });

  it("old writers refuse to re-evaluate a session with a newer decision", () => {
    expect(() => assertCanEvaluateSession([1, 1, null])).not.toThrow();
    expect(() => assertCanEvaluateSession([])).not.toThrow();
    expect(() => assertCanEvaluateSession([1, 2])).not.toThrow();
    expect(() => assertCanEvaluateSession([1, 4])).toThrow(/gate version 4/);
  });
});
