import type { View } from "./helpers";
import type { RequirementGateResult } from "./requirement-gate";

/**
 * #230: why a council ended without an approvable recommendation, in the words a non-technical reader needs. Built
 * only from the stored gate result (#181) – it explains, it never re-decides: the gate stays the single source.
 *
 * One reason per proposal, the most concrete first:
 * - `violated`     – a requirement is not met according to the evaluators (FAIL);
 * - `disputed`     – evaluators contradict each other on a requirement (DISPUTED);
 * - `notEvaluated` – an expected evaluator gave no valid answer for a requirement (a technical gap, not a finding);
 * - `notProven`    – the evaluators could not confirm a requirement from the proposal (UNKNOWN) – not the same as unmet;
 * - `limitedReview`– every check passed, but too few independent evaluators took part (#249);
 * - `architectureCandidate` – every check passed, but a requirement can only be confirmed by measuring the running
 *                    implementation (#249 part 2): its plan was confirmed, not the requirement;
 * - `qualified`    – nothing open here; another rule (minimum score, security minimum, objection) decides.
 */
export type WhyKind = "violated" | "disputed" | "notEvaluated" | "notProven" | "limitedReview" | "architectureCandidate" | "qualified";

export interface WhyProposal {
  proposalId: string;
  kind: WhyKind;
  /** Requirement labels (R1, R2 …) behind the reason, in list order. */
  requirements: string[];
  /** For a single violated/disputed requirement: how many evaluators said met / not met. */
  counts?: { pass: number; fail: number; total: number };
}

export interface WhyNoRecommendation {
  proposals: WhyProposal[];
  /** The hard requirements contradict each other (#121): changing one of them is the way on. */
  requirementsConflict: boolean;
  /** Next steps that exist today, in the order to try them. */
  steps: Array<"repeatEvaluation" | "addEvidence" | "reviewRequirement" | "resolveConflict" | "chooseOther" | "markFavorite" | "prototypeBuild" | "recordMeasurement">;
}

const PRIORITY: WhyKind[] = ["violated", "disputed", "notEvaluated", "notProven", "limitedReview", "architectureCandidate", "qualified"];

export function explainNoRecommendation(
  view: Pick<View, "requirementList">,
  gate: RequirementGateResult | undefined,
  options: { requirementsConflict?: boolean; failedEvaluators?: number; approvableProposals?: number } = {},
): WhyNoRecommendation | null {
  if (!gate) return null;
  const items = view.requirementList?.items ?? [];
  const label = (id: string) => {
    const index = items.findIndex((i) => i.id === id);
    return index >= 0 ? `R${index + 1}` : id;
  };
  const proposals = gate.proposals.map((g): WhyProposal => {
    const req = g.requirements;
    const pick = (kind: WhyKind): WhyProposal | null => {
      const hits =
        kind === "violated"
          ? req.filter((r) => r.status === "FAIL")
          : kind === "disputed"
            ? req.filter((r) => r.status === "DISPUTED")
            : kind === "notEvaluated"
              ? req.filter((r) => r.open.length > 0)
              : kind === "notProven"
                ? req.filter((r) => r.status === "UNKNOWN")
                : [];
      if (!hits.length) return null;
      const single = hits.length === 1 ? hits[0]! : null;
      return {
        proposalId: g.proposalId,
        kind,
        requirements: hits.map((r) => label(r.requirementId)),
        ...(single && (kind === "violated" || kind === "disputed")
          ? {
              counts: {
                pass: single.pass.length,
                fail: single.fail.length,
                total: single.pass.length + single.fail.length + single.unknown.length + single.open.length,
              },
            }
          : {}),
      };
    };
    for (const kind of PRIORITY.slice(0, 4)) {
      const found = pick(kind);
      if (found) return found;
    }
    if (g.limitedReview) return { proposalId: g.proposalId, kind: "limitedReview", requirements: [] };
    if (g.architectureCandidate)
      return {
        proposalId: g.proposalId,
        kind: "architectureCandidate",
        requirements: req.filter((r) => r.measurementPending).map((r) => label(r.requirementId)),
      };
    return { proposalId: g.proposalId, kind: "qualified", requirements: [] };
  });
  const kinds = new Set(proposals.map((p) => p.kind));
  const steps: WhyNoRecommendation["steps"] = [];
  if ((options.failedEvaluators ?? 0) > 0 || kinds.has("notEvaluated")) steps.push("repeatEvaluation");
  // #511: an architecture candidate is not stuck – it can be marked, measured in a prototype build and approved after
  // measurement (#249 part 2).
  if (kinds.has("architectureCandidate")) steps.push("markFavorite", "prototypeBuild", "recordMeasurement");
  if (options.requirementsConflict) steps.push("resolveConflict");
  if (kinds.has("notProven") || kinds.has("disputed") || kinds.has("limitedReview")) steps.push("addEvidence");
  if (kinds.has("violated")) steps.push("reviewRequirement");
  if ((options.approvableProposals ?? 0) > 0) steps.push("chooseOther");
  return { proposals, requirementsConflict: options.requirementsConflict === true, steps };
}
