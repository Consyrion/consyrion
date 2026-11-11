import type { RequirementGateResult } from "./requirement-gate";

/**
 * Idea check (#597): how a council started with the purpose "idea_check" reads a verdict in which nothing can be
 * approved. Many users are at the very start – no contract, no measurement – and only want to know whether the idea
 * holds up. For them "needs verification – not approvable" looks as if the app had not decided, although the proposals
 * were compared and none of the remaining ones failed a requirement.
 *
 * This only READS the stored matrix: the engine's gate result and the totals. It changes no status, approves nothing
 * and never turns an unconfirmed requirement into a confirmed one – the open points are listed as "clarify before the
 * next step". Approval and build keep the strict gate.
 */
export interface IdeaCheckMatrix {
  proposals?: Array<{ proposalId: string; total: number | null }>;
  requirementGate?: RequirementGateResult;
  failedEvaluators?: unknown[];
}

export interface IdeaCheckResult {
  /**
   * "favorite": one proposal leads among those no evaluator ruled out. "several": more than one within the tie margin.
   * "none": every proposal fails at least one requirement – the idea does not hold up as described.
   */
  kind: "favorite" | "several" | "none";
  /** The leading proposal(s), best total first; empty for "none". */
  leaders: string[];
  /** Requirements of the first leader that are not confirmed (or only have a measurement plan) – to clarify first. */
  toClarify: string[];
  /** Proposals ruled out, with the requirements they do not meet (FAIL or disputed). */
  excluded: Array<{ proposalId: string; requirementIds: string[] }>;
}

/** Totals closer than this are not ranked against each other (the policy's default tie margin). */
const TIE_MARGIN = 0.25;

/**
 * Null when the matrix cannot carry an idea check: no gate result, proposals not compared on equal terms, or evaluators
 * missing – then the normal verdict text says what has to happen first (repeat the evaluation).
 */
export function ideaCheck(matrix: IdeaCheckMatrix | null | undefined): IdeaCheckResult | null {
  const gate = matrix?.requirementGate;
  if (!gate?.proposals?.length || gate.comparisonComplete === false || (matrix?.failedEvaluators ?? []).length > 0) return null;
  const total = (id: string) => matrix?.proposals?.find((p) => p.proposalId === id)?.total ?? null;
  const excluded = gate.proposals
    .filter((g) => g.feasibility === "fail")
    .map((g) => ({
      proposalId: g.proposalId,
      requirementIds: g.requirements.filter((r) => r.status === "FAIL" || r.status === "DISPUTED").map((r) => r.requirementId),
    }));
  // An incomplete proposal was not fully evaluated: neither a favourite nor ruled out.
  const standing = gate.proposals
    .filter((g) => g.feasibility === "qualified" || g.feasibility === "needs_verification")
    .filter((g) => total(g.proposalId) !== null)
    .sort((a, b) => total(b.proposalId)! - total(a.proposalId)! || a.proposalId.localeCompare(b.proposalId));
  if (!standing.length) return gate.proposals.every((g) => g.feasibility === "fail") ? { kind: "none", leaders: [], toClarify: [], excluded } : null;
  const best = total(standing[0]!.proposalId)!;
  const leaders = standing.filter((g) => Math.round(best * 100) - Math.round(total(g.proposalId)! * 100) < TIE_MARGIN * 100);
  const toClarify = leaders[0]!.requirements.filter((r) => r.status !== "PASS" || r.measurementPending === true).map((r) => r.requirementId);
  return { kind: leaders.length > 1 ? "several" : "favorite", leaders: leaders.map((g) => g.proposalId), toClarify, excluded };
}

/** The purpose a council was started with; anything but "idea_check" (also absent, for older councils) is "approval". */
export function councilPurpose(policy: unknown): "idea_check" | "approval" {
  return (policy as { purpose?: unknown } | null | undefined)?.purpose === "idea_check" ? "idea_check" : "approval";
}
