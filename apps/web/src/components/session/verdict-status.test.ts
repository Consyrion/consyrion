import { describe, expect, it } from "vitest";
import type { View } from "./helpers";
import { nextStepsTarget, verdictStatus } from "./verdict-status";

/** Minimal session views for each verdict case (test data, not a real run). */
const view = (over: { outcome?: string; status?: Record<string, unknown> | null; matrix?: Record<string, unknown>; session?: string }) =>
  ({
    session: { status: over.session ?? "awaiting_approval" },
    decision: over.outcome ? { outcome: over.outcome, matrix: over.matrix ?? {} } : null,
    decisionStatus: over.status === null ? null : { readable: true, approvable: true, gateVersion: 2, approvableProposalIds: ["p1"], ...over.status },
  }) as unknown as View;

describe("one verdict status for screen, header and PDF (#268)", () => {
  it("recommended and approvable: approve first, nothing contradicts the header", () => {
    const s = verdictStatus(view({ outcome: "recommended", status: { canApproveRecommendation: true } }));
    expect(s).toMatchObject({ outcomeKey: "recommended", tone: "success", initialAction: "approve", nothingApprovable: false, notApprovable: false, s1: true });
  });

  it("not approvable never offers approve, also with a 'recommended' outcome stored", () => {
    const s = verdictStatus(view({ outcome: "recommended", status: { approvable: false, canApproveRecommendation: true, approvableProposalIds: [] } }));
    expect(s.initialAction).not.toBe("approve");
    expect(s).toMatchObject({ outcomeKey: "not_approvable", tone: "warning", nothingApprovable: true });
  });

  it("names limited review, architecture candidate and needs verification in this order", () => {
    const gate = (g: Record<string, unknown>) => ({ requirementGate: { proposals: [{ proposalId: "p1", feasibility: "qualified", ...g }] } });
    const blocked = { approvable: false, approvableProposalIds: [] };
    expect(verdictStatus(view({ outcome: "needs_verification", status: blocked, matrix: gate({ limitedReview: true }) })).outcomeKey).toBe("provisional");
    expect(verdictStatus(view({ outcome: "needs_verification", status: blocked, matrix: gate({ architectureCandidate: true }) })).outcomeKey).toBe(
      "architecture_candidate",
    );
    expect(verdictStatus(view({ outcome: "needs_verification", status: blocked, matrix: gate({}) }))).toMatchObject({
      outcomeKey: "needs_verification",
      initialAction: "request_changes",
    });
    // Missing evaluators: asking them again comes first.
    expect(verdictStatus(view({ outcome: "needs_verification", status: blocked, matrix: { failedEvaluators: [{}] } })).initialAction).toBe("repeat_evaluation");
  });

  it("conflicting requirements → conflict and reject; no qualifying solution → changed brief", () => {
    expect(verdictStatus(view({ outcome: "no_qualifying_solution", matrix: { requirementsConflict: true } }))).toMatchObject({
      outcomeKey: "conflict",
      tone: "danger",
      initialAction: "reject",
    });
    expect(verdictStatus(view({ outcome: "no_qualifying_solution", status: { approvableProposalIds: [] } }))).toMatchObject({
      outcomeKey: "no_qualifying_solution",
      initialAction: "request_changes",
    });
  });

  it("gate versions 2 and 3 share the S1 locks; an unknown newer one does not", () => {
    expect(verdictStatus(view({ outcome: "tie", status: { gateVersion: 3 } })).s1).toBe(true);
    expect(verdictStatus(view({ outcome: "tie", status: { gateVersion: 4 } })).s1).toBe(false);
  });

  it("a favourite or prototype build is a typed mark beside the verdict, never the verdict itself (#249 part 2)", () => {
    const blocked = view({ outcome: "needs_verification", status: { approvable: false, approvableProposalIds: [] } });
    const fav = verdictStatus({ ...blocked, humanMark: { kind: "favorite", proposalId: "p1" } } as unknown as View);
    expect(fav).toMatchObject({ outcomeKey: "needs_verification", humanMark: { kind: "favorite", proposalId: "p1" }, marks: ["favoriteNotRegular"] });
    const proto = verdictStatus({ ...blocked, humanMark: { kind: "prototype_build", proposalId: "p1" } } as unknown as View);
    expect(proto.marks).toEqual(["prototypeBuild"]);
    expect(proto.initialAction).not.toBe("approve");
    // Gesamttest 08.11.26: the next step moves on after the human mark.
    const ready = { prototypeProposalIds: ["p1"], approvable: false, approvableProposalIds: [] };
    expect(verdictStatus(view({ outcome: "needs_verification", status: ready })).initialAction).toBe("mark_favorite");
    expect(
      verdictStatus({ ...view({ outcome: "needs_verification", status: ready }), humanMark: { kind: "favorite", proposalId: "p1" } } as unknown as View)
        .initialAction,
    ).toBe("approve_prototype");
    expect(
      verdictStatus({ ...view({ outcome: "needs_verification", status: ready }), humanMark: { kind: "prototype_build", proposalId: "p1" } } as unknown as View)
        .initialAction,
    ).toBe("record_measurement");
    expect(
      verdictStatus({
        ...view({ outcome: "needs_verification", status: { ...ready, measurementApprovableProposalIds: ["p1"] } }),
        humanMark: { kind: "prototype_build", proposalId: "p1" },
      } as unknown as View).initialAction,
    ).toBe("approve_after_measurement");
  });

  it("the next steps are about the favourite once a human marked one, not the best-scored proposal (live check 08.11.26)", () => {
    const blocked = {
      ...view({
        outcome: "needs_verification",
        status: { approvable: false, approvableProposalIds: [] },
        matrix: {
          proposals: [
            { proposalId: "p3", total: 8 },
            { proposalId: "p2", total: 7 },
          ],
        },
      }),
      approvals: [],
    } as unknown as View;
    expect(nextStepsTarget(blocked)).toEqual({ proposalId: "p3", mode: "blocked" });
    expect(nextStepsTarget({ ...blocked, humanMark: { kind: "favorite", proposalId: "p2" } } as unknown as View)).toEqual({
      proposalId: "p2",
      mode: "favorite",
    });
  });

  it("an archived project offers no next step (#548, live check 08.11.26)", () => {
    const ready = view({ outcome: "needs_verification", status: { prototypeProposalIds: ["p1"], approvable: false, approvableProposalIds: [] } });
    expect(verdictStatus(ready).archived).toBe(false);
    expect(verdictStatus({ ...ready, project: { status: "archived" } } as unknown as View).archived).toBe(true);
  });

  it("no verdict yet: no title and no human mark", () => {
    const s = verdictStatus(view({ status: null, session: "running" }));
    expect(s).toMatchObject({ outcomeKey: null, nothingApprovable: false, humanMark: null, marks: [] });
  });
});

describe("#511 architecture candidate: the first step is marking it as favourite, never an approval", () => {
  it("offers mark_favorite when the server lists a prototype-eligible proposal; otherwise request_changes as before", () => {
    const matrix = { requirementGate: { proposals: [{ proposalId: "p1", feasibility: "needs_verification", architectureCandidate: true }] } };
    const candidate = verdictStatus(
      view({ outcome: "needs_verification", status: { approvable: false, approvableProposalIds: [], gateVersion: 3, prototypeProposalIds: ["p1"] }, matrix }),
    );
    expect(candidate).toMatchObject({ outcomeKey: "architecture_candidate", initialAction: "mark_favorite", notApprovable: true });
    const plain = verdictStatus(view({ outcome: "needs_verification", status: { approvable: false, approvableProposalIds: [], gateVersion: 3 } }));
    expect(plain.initialAction).toBe("request_changes");
  });
});
