import { awaitingReviewWithoutApproval } from "@consyrion/core/browser";
import type { View } from "./helpers";
import type { RequirementGateResult } from "./requirement-gate";
import type { NextAction, OutcomeKey } from "./verdict-dashboard";

/**
 * The status of a Final Verdict as the reader sees it – one derivation for the verdict screen, the session header and
 * the PDF (#268: no second truth in the export). Only reads what the server decided (`decisionStatus`, the stored
 * matrix); it never re-checks the gate or the format.
 */
export interface VerdictStatus {
  /** A verdict is stored and readable by this release. */
  readable: boolean;
  /** The server says nothing may be approved (#181). */
  notApprovable: boolean;
  /** The council found the hard requirements conflict (#121). */
  conflict: boolean;
  /** Gate versions 2 and 3 share the S1 locks (#181, #249 part 2). */
  s1: boolean;
  /** The title of the verdict (`verdict.dashboard.outcome.<key>`); null while no verdict exists. */
  outcomeKey: OutcomeKey | null;
  tone: "success" | "warning" | "danger" | "neutral";
  /** The first step the decision form offers (#266). */
  initialAction: NextAction;
  /** #477: the workflow waits for a human, but no proposal can be approved – header says "awaiting your review". */
  nothingApprovable: boolean;
  /** Proposals the server lets a human approve. */
  approvableProposalIds: string[];
  /**
   * A human action after the verdict (#249 part 2, filled there) – never a verdict of the council: the outcome stays as
   * it is when someone marks a favourite or a prototype build.
   */
  humanMark: { kind: "favorite" | "prototype_build"; proposalId: string } | null;
  /** Typed notes shown beside the status, worded via `verdictScreen.mark.*` (never free strings). */
  marks: VerdictMark[];
}

export type VerdictMark = "prototypeBuild" | "favoriteNotRegular";

// #230: no_qualifying_solution is about the proposals of this council, never about every possible solution.
const OUTCOME_TONE: Record<string, VerdictStatus["tone"]> = {
  recommended: "success",
  tie: "warning",
  no_qualifying_solution: "danger",
  insufficient_evidence: "warning",
};

type Matrix = { requirementGate?: RequirementGateResult; requirementsConflict?: boolean; failedEvaluators?: unknown[] };

export function verdictStatus(view: View): VerdictStatus {
  const decision = view.decision;
  const status = view.decisionStatus;
  const readable = status?.readable ?? false;
  const notApprovable = status ? !status.approvable : false;
  const matrix = readable ? (decision?.matrix as unknown as Matrix | undefined) : undefined;
  const conflict = !notApprovable && matrix?.requirementsConflict === true;
  const s1 = status?.gateVersion === 2 || status?.gateVersion === 3;
  const approvableProposalIds = status?.approvableProposalIds ?? [];
  const missingEvaluators = (matrix?.failedEvaluators ?? []).length;
  // #511: an architecture candidate is not a dead end – the first step offered is marking it as favourite (no approval).
  const prototypeReady = (status?.prototypeProposalIds ?? []).length > 0;
  const initialAction: NextAction = notApprovable
    ? missingEvaluators > 0
      ? "repeat_evaluation"
      : prototypeReady
        ? "mark_favorite"
        : "request_changes"
    : decision?.outcome === "recommended" && status?.canApproveRecommendation
      ? "approve"
      : (decision?.outcome === "insufficient_evidence" || decision?.outcome === "needs_verification") && missingEvaluators > 0
        ? "repeat_evaluation"
        : conflict
          ? "reject"
          : // No proposal can be approved (no qualifying solution): the way on is a changed brief, not a failed proposal.
            readable && approvableProposalIds.length === 0
            ? "request_changes"
            : "select_alternative";
  const gates = matrix?.requirementGate?.proposals ?? [];
  // #249: every check passed but too few independent evaluators took part; part 2: only a measurement plan confirmed.
  const provisional = gates.some((g) => g.limitedReview);
  const architectureCandidate = gates.some((g) => (g as { architectureCandidate?: boolean }).architectureCandidate);
  const outcomeKey: OutcomeKey | null = !decision
    ? null
    : notApprovable
      ? provisional
        ? "provisional"
        : architectureCandidate
          ? "architecture_candidate"
          : decision.outcome === "needs_verification"
            ? "needs_verification"
            : "not_approvable"
      : conflict
        ? "conflict"
        : OUTCOME_TONE[decision.outcome]
          ? (decision.outcome as OutcomeKey)
          : "not_approvable";
  const tone: VerdictStatus["tone"] = notApprovable ? "warning" : conflict ? "danger" : (OUTCOME_TONE[decision?.outcome ?? ""] ?? "warning");
  // Gesamttest #275 / #477: "awaiting your decision" next to "not approvable" contradicted itself.
  const nothingApprovable = awaitingReviewWithoutApproval(view.session.status, status);
  // #249 part 2: the latest favourite / prototype mark of this verdict – a human action, the outcome stays as it is.
  const mark = (view as { humanMark?: { kind: "favorite" | "prototype_build"; proposalId: string } | null }).humanMark ?? null;
  const humanMark = mark ? { kind: mark.kind, proposalId: mark.proposalId } : null;
  const marks: VerdictMark[] = humanMark ? [humanMark.kind === "prototype_build" ? "prototypeBuild" : "favoriteNotRegular"] : [];
  return { readable, notApprovable, conflict, s1, outcomeKey, tone, initialAction, nothingApprovable, approvableProposalIds, humanMark, marks };
}

export type NextStepsMode = "chosen" | "recommended" | "tie" | "blocked";

/**
 * For which proposal the next steps are shown (#273), and how they are introduced – one choice for the verdict screen
 * and the PDF (#268): a human choice wins, then the approvable recommendation, else the best-scored proposal.
 */
export function nextStepsTarget(view: View, status: VerdictStatus = verdictStatus(view)): { proposalId: string | null; mode: NextStepsMode } | null {
  const decision = view.decision;
  const matrix = status.readable ? (decision?.matrix as unknown as { proposals?: Array<{ proposalId: string; total: number | null }> } | undefined) : undefined;
  if (!decision || !matrix) return null;
  const recommendedId = status.notApprovable ? null : (decision.recommendedProposalId ?? null);
  const best = [...(matrix.proposals ?? [])].sort((a, b) => (b.total ?? -1) - (a.total ?? -1))[0]?.proposalId ?? null;
  // A human choice wins (ChatGPT test 06.11.26: decided tie sessions still read "nothing can be approved yet").
  const last = (view.approvals ?? []).at(-1);
  const chosenId = last && (last.action === "approve" || last.action === "select_alternative") ? (last.selectedProposalId ?? recommendedId) : null;
  const mode: NextStepsMode = chosenId ? "chosen" : recommendedId ? "recommended" : status.approvableProposalIds.length ? "tie" : "blocked";
  return { proposalId: chosenId ?? recommendedId ?? best, mode };
}
