/**
 * Idea check (#597): how a council started with the purpose "idea_check" reads a verdict in which nothing can be
 * approved. Many users are at the very start – no contract, no measurement – and only want to know whether the idea
 * holds up. For them "needs verification – not approvable" looks as if the app had not decided, although the proposals
 * were compared and none of the remaining ones failed a requirement.
 *
 * This only READS the stored matrix: the engine's gate result and the totals. It changes no status, approves nothing
 * and never turns an unconfirmed requirement into a confirmed one – the open points are listed as "clarify before the
 * next step". Approval and build keep the strict gate. One derivation for the verdict screen, the PDF and the
 * Markdown report.
 */
export interface IdeaCheckGate {
  proposals: ReadonlyArray<{
    proposalId: string;
    feasibility: string;
    requirements: ReadonlyArray<{ requirementId: string; status: string; measurementPending?: boolean }>;
  }>;
  comparisonComplete?: boolean;
}

export interface IdeaCheckMatrix {
  proposals?: ReadonlyArray<{ proposalId: string; total: number | null }>;
  requirementGate?: IdeaCheckGate | null;
  failedEvaluators?: readonly unknown[];
}

export interface IdeaCheckResult {
  /**
   * "favorite": one proposal leads among those no evaluator ruled out. "several": more than one within the tie margin
   * with the same number of open points. "none": every proposal fails at least one requirement.
   */
  kind: "favorite" | "several" | "none";
  /** The leading proposal(s); empty for "none". */
  leaders: string[];
  /**
   * For "favorite": proposals whose total is within the tie margin but that leave more requirements open – the
   * favourite was chosen for its fewer open points, not for a better score (live test 11.11.26).
   */
  tiedWith: string[];
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
  const openOf = (g: IdeaCheckGate["proposals"][number]) =>
    g.requirements.filter((r) => r.status !== "PASS" || r.measurementPending === true).map((r) => r.requirementId);
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
  if (!standing.length)
    return gate.proposals.every((g) => g.feasibility === "fail") ? { kind: "none", leaders: [], tiedWith: [], toClarify: [], excluded } : null;
  const best = total(standing[0]!.proposalId)!;
  const level = standing.filter((g) => Math.round(best * 100) - Math.round(total(g.proposalId)! * 100) < TIE_MARGIN * 100);
  // Level on points: the proposal that leaves the fewest requirements open is the favourite; equal there too = several.
  const fewest = Math.min(...level.map((g) => openOf(g).length));
  const leaders = level.filter((g) => openOf(g).length === fewest);
  const tiedWith = leaders.length === 1 ? level.filter((g) => g !== leaders[0]).map((g) => g.proposalId) : [];
  return {
    kind: leaders.length > 1 ? "several" : "favorite",
    leaders: leaders.map((g) => g.proposalId),
    tiedWith,
    toClarify: openOf(leaders[0]!),
    excluded,
  };
}

/** The purpose a council was started with; anything but "idea_check" (also absent, for older councils) is "approval". */
export function councilPurpose(policy: unknown): "idea_check" | "approval" {
  return (policy as { purpose?: unknown } | null | undefined)?.purpose === "idea_check" ? "idea_check" : "approval";
}
