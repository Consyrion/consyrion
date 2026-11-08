import { COUNCIL_PHASE_LABELS, type EvaluationWeights } from "./phases";

const PHASE_NAMES: Readonly<Record<string, string>> = COUNCIL_PHASE_LABELS;

export const CRITERIA = ["technicalQuality", "security", "maintainability", "operatingCost", "implementationSpeed"] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface ScoreInput {
  proposalId: string;
  authorParticipantId: string;
  evaluatorParticipantId: string;
  criterion: Criterion;
  score: number;
}

export interface ObjectionInput {
  proposalId: string;
  blocking: boolean;
  status: "open" | "refuted" | "resolved" | "accepted" | "unresolved";
  severity: "low" | "medium" | "high" | "critical";
}

export interface VoteInput {
  evaluatorParticipantId: string;
  ranking: string[];
  /**
   * The evaluator's independent check per proposal (#121): does it, as written, satisfy every hard requirement
   * of the brief? Absent for runs before this check existed.
   */
  requirementChecks?: ReadonlyArray<{ proposalId: string; meets: boolean }>;
}

export interface ProposalInput {
  proposalId: string;
  authorParticipantId: string;
  /**
   * The author's own statement (#121): false when the proposal is a finding that the hard requirements cannot be
   * met together, not a solution. Absent for runs before this field existed.
   */
  solvesRequirements?: boolean;
}

/**
 * Result of the S1 requirement gate (gate version 2, #181), computed by the engine – the only authority on
 * feasibility of a version-2 verdict. This aggregation only maps it onto eligibility and the outcome.
 */
export interface RequirementGate {
  proposals: ReadonlyArray<{
    proposalId: string;
    feasibility: "qualified" | "needs_verification" | "fail" | "incomplete";
    causes: ReadonlyArray<string>;
    /** Requirements that are FAIL or DISPUTED, of all requirements. */
    failedRequirements: number;
    requirements: number;
    /** The one evaluator whose statements alone keep the proposal from qualified, if any. */
    soleBlocker: string | null;
  }>;
  comparisonComplete: boolean;
  comparisonNote: string | null;
}

export interface VerdictConfig {
  weights: EvaluationWeights;
  minSecurityScore: number;
  minTotalScore: number;
  tieMargin: number;
  /**
   * Vote weight 1–10 per evaluator participant (#140): how much its scores and its ranking count. Missing = 1. The
   * feasibility gate stays one evaluator, one check – a single strong model must not overrule a hard requirement.
   */
  evaluatorWeights?: Readonly<Record<string, number>>;
  /**
   * Independence group per participant (user decision 08.11.26, `independenceKey`): instances of one model through
   * different keys share a group. A group is ONE voice – its instances' weights are split among them, it never scores
   * or ranks a proposal written by its own group, and it counts once as an independent evaluator. Missing = every
   * participant its own group (the behaviour before).
   */
  evaluatorGroups?: Readonly<Record<string, string>>;
}

export interface ProposalVerdict {
  proposalId: string;
  criterionMeans: Partial<Record<Criterion, number>>;
  /** Spread (max − min) of the independent scores per criterion – shows how much evaluators disagreed. */
  criterionSpread: Partial<Record<Criterion, number>>;
  total: number | null;
  independentEvaluators: number;
  /** Evaluators that should have scored this proposal (all participants except its author); null when unknown. */
  expectedEvaluators: number | null;
  /**
   * Whether this proposal is a solution that can be approved for implementation (#121): its author does not
   * declare the requirements unsolvable and no majority of independent evaluators finds that it misses a hard
   * requirement. A well-argued finding can score high and still not be implementable.
   */
  implementable: boolean;
  /** Independent requirement checks: how many evaluators found a hard requirement unmet, out of how many. */
  requirementChecks: { failed: number; total: number };
  /** The mean security score is below the policy minimum – a hard limit no human choice may override (gate version 2). */
  securityBelowMinimum: boolean;
  eligible: boolean;
  ineligibleReasons: string[];
  bordaPoints: number;
}

/** Why a verdict should be read with care even though a proposal is recommended. */
export type ConfidenceIssue =
  | { kind: "missing_evaluators"; proposalId: string; evaluators: number; expected: number }
  | { kind: "vote_disagrees"; majorityVoteWinnerId: string }
  /** A configured model dropped out of the council (e.g. invalid answers in Independent Thinking) (#96). */
  | { kind: "participant_failed"; modelId: string; provider: string; reason: string }
  /** Objections that no independent reviewer could decide. */
  | { kind: "unreviewed_objections"; count: number }
  /** Scored by a single independent evaluator because the council has only two models (allowed, but thin). */
  | { kind: "single_evaluator"; proposalId: string }
  /** Half of the independent evaluators found a hard requirement unmet – not a majority, but not settled (#121). */
  | { kind: "requirements_disputed"; proposalId: string; failed: number; total: number }
  /** Fewer than half of the models that should evaluate delivered usable scores: no recommendation (#145). */
  | { kind: "insufficient_evaluators"; evaluators: number; expected: number }
  /** The vote weights changed the outcome against an equal vote of every evaluator (#140): both are shown. */
  | { kind: "weighting_changed_winner"; weightedWinnerId: string | null; unweightedWinnerId: string | null; unweightedOutcome: VerdictOutcome }
  /** Gate version 2 (#181): the proposals were not compared on equal terms, so there is no automatic recommendation. */
  | { kind: "comparison_incomplete"; note: string }
  /**
   * Gate version 2: a higher-scored proposal is blocked only by the author of the best qualified one – its statements
   * may be honest, but they decide in its own favour, so no automatic recommendation.
   */
  | { kind: "conflict_of_interest"; proposalId: string; blockedProposalId: string }
  /** An evaluator's scores for a proposal were dropped because it restated another proposal's title (#145). */
  | { kind: "evaluation_rejected"; proposalId: string; count: number }
  /** A debate phase ended early to keep the token budget for the Final Verdict (#148). */
  | { kind: "phase_shortened"; phase: string }
  /** An active model delivered no role review in the 12 Minds Council: its perspectives are missing from the debate (#172). */
  | { kind: "no_debate_contribution"; modelId: string; provider: string }
  /**
   * The author of a proposal could not answer the objections against it because its model failed (#175): they are
   * unanswered, not uncontested.
   */
  | { kind: "undefended_proposal"; proposalId: string; count: number; reason: string };

/** normal = full review depth; reduced = a deliberately small but complete council; low = something failed or is missing. */
export type Confidence = "normal" | "reduced" | "low";

const REDUCING: ReadonlySet<ConfidenceIssue["kind"]> = new Set(["single_evaluator", "unreviewed_objections", "weighting_changed_winner"]);

export function confidenceOf(issues: ReadonlyArray<ConfidenceIssue>): Confidence {
  if (issues.length === 0) return "normal";
  return issues.every((issue) => REDUCING.has(issue.kind)) ? "reduced" : "low";
}

/**
 * needs_verification is produced only with the S1 gate (gate version 2, #181): no qualified candidate but at least one
 * proposal that needs verification, or qualified candidates that were not compared on equal terms.
 */
export type VerdictOutcome = "recommended" | "no_qualifying_solution" | "tie" | "insufficient_evidence" | "needs_verification";

export interface VerdictResult {
  outcome: VerdictOutcome;
  recommendedProposalId: string | null;
  tiedProposalIds: string[];
  proposals: ProposalVerdict[];
  majorityVoteWinnerId: string | null;
  formula: string;
  /** See `confidenceOf`: failures and missing evaluations → low; a thin but complete review → reduced. */
  confidence: Confidence;
  confidenceIssues: ConfidenceIssue[];
  /**
   * True when no proposal is an implementable solution because the council found that the hard requirements
   * cannot be met together (#121). The outcome is then no_qualifying_solution: the finding can be confirmed,
   * nothing can be built under these requirements.
   */
  requirementsConflict: boolean;
}

/**
 * Rounding rule for every score (#122): half up to two decimals, applied to the decimal value. Binary sums carry
 * artefacts (an exact 9.275 adds up to 9.2749999999999986), so the value in hundredths is first normalised to 12
 * significant digits – far beyond the precision of 0–10 scores with integer percent weights, far below the
 * artefacts – and only then rounded. The result no longer depends on the order of the contributions.
 */
export function roundScore(value: number) {
  return Math.round(Number((value * 100).toPrecision(12))) / 100;
}

/** Score in whole hundredths, for exact comparisons of rounded values (ties, minimums). */
const hundredths = (value: number) => Math.round(value * 100);

/**
 * Deterministic Final Verdict aggregation. Self-evaluations are discarded, hard gates are applied
 * before selection, close totals are reported as a tie and the majority vote is kept separate from
 * the weighted quality score. The same inputs always give the same result.
 */
export function aggregateVerdict(
  proposals: ReadonlyArray<ProposalInput>,
  scores: ReadonlyArray<ScoreInput>,
  objections: ReadonlyArray<ObjectionInput>,
  votes: ReadonlyArray<VoteInput>,
  config: VerdictConfig,
  participantIds?: ReadonlyArray<string>,
  extraIssues: ReadonlyArray<ConfidenceIssue> = [],
  /** Gate version 2 only: replaces the version-1 feasibility rule (#181). */
  gate?: RequirementGate,
): VerdictResult {
  const weighted = aggregateWith(proposals, scores, objections, votes, config, participantIds, extraIssues, gate);
  const used = new Set([...scores.map((s) => s.evaluatorParticipantId), ...votes.map((v) => v.evaluatorParticipantId)]);
  const weightValues = new Set([...used].map((id) => evaluatorWeight(config, id)));
  if (weightValues.size <= 1) return weighted;
  // Unequal weights: compare with an equal vote of every evaluator and say so when the outcome differs (#140).
  const equal = aggregateWith(proposals, scores, objections, votes, { ...config, evaluatorWeights: undefined }, participantIds, extraIssues, gate);
  if (equal.outcome === weighted.outcome && equal.recommendedProposalId === weighted.recommendedProposalId) return weighted;
  const issues: ConfidenceIssue[] = [
    ...weighted.confidenceIssues,
    {
      kind: "weighting_changed_winner",
      weightedWinnerId: weighted.recommendedProposalId,
      unweightedWinnerId: equal.recommendedProposalId,
      unweightedOutcome: equal.outcome,
    },
  ];
  return { ...weighted, confidenceIssues: issues, confidence: confidenceOf(issues) };
}

/** Weight of one evaluator: 1–10, missing or invalid = 1. */
function evaluatorWeight(config: VerdictConfig, participantId: string) {
  const w = config.evaluatorWeights?.[participantId];
  return typeof w === "number" && Number.isFinite(w) ? Math.min(10, Math.max(1, Math.round(w))) : 1;
}

const groupOf = (config: VerdictConfig, participantId: string) => config.evaluatorGroups?.[participantId] ?? participantId;

/** Weight of one instance as a share of its group's voice: its own weight divided by the instances of its group. */
function voiceWeight(config: VerdictConfig, participantId: string) {
  const group = groupOf(config, participantId);
  const size = config.evaluatorGroups ? Object.values(config.evaluatorGroups).filter((g) => g === group).length : 1;
  return evaluatorWeight(config, participantId) / Math.max(1, size);
}

function aggregateWith(
  proposals: ReadonlyArray<ProposalInput>,
  scores: ReadonlyArray<ScoreInput>,
  objections: ReadonlyArray<ObjectionInput>,
  votes: ReadonlyArray<VoteInput>,
  config: VerdictConfig,
  /**
   * Participants still active in the Final Verdict. Models that dropped out earlier are not expected evaluators
   * (#151); they are reported through `extraIssues` (participant_failed) instead (#96).
   */
  participantIds?: ReadonlyArray<string>,
  /** Issues known outside the score table: dropped-out models, unreviewed objections. */
  extraIssues: ReadonlyArray<ConfidenceIssue> = [],
  gate?: RequirementGate,
): VerdictResult {
  // An instance of the author's model is no independent evaluator of that proposal (user decision 08.11.26).
  const independent = scores.filter((s) => groupOf(config, s.evaluatorParticipantId) !== groupOf(config, s.authorParticipantId));
  const borda = new Map<string, number>();
  const meanVoteWeight = votes.length ? votes.reduce((a, v) => a + voiceWeight(config, v.evaluatorParticipantId), 0) / votes.length : 1;
  for (const vote of votes) {
    const ranked = vote.ranking.filter((id) =>
      proposals.some((p) => p.proposalId === id && groupOf(config, p.authorParticipantId) !== groupOf(config, vote.evaluatorParticipantId)),
    );
    // Relative to the mean weight of the voters, so equal weights give exactly the plain Borda points.
    const w = voiceWeight(config, vote.evaluatorParticipantId) / meanVoteWeight;
    ranked.forEach((id, index) => borda.set(id, (borda.get(id) ?? 0) + (ranked.length - index - 1) * w));
  }

  const results: ProposalVerdict[] = [...proposals]
    .sort((a, b) => a.proposalId.localeCompare(b.proposalId))
    .map(({ proposalId, authorParticipantId, solvesRequirements }) => {
      const own = independent.filter((s) => s.proposalId === proposalId);
      const evaluators = new Set(own.map((s) => groupOf(config, s.evaluatorParticipantId))).size;
      const criterionMeans: Partial<Record<Criterion, number>> = {};
      const criterionSpread: Partial<Record<Criterion, number>> = {};
      let total = 0;
      let complete = evaluators > 0;
      for (const criterion of CRITERIA) {
        const rows = own.filter((s) => s.criterion === criterion);
        const values = rows.map((s) => s.score);
        if (values.length === 0) {
          complete = false;
          continue;
        }
        // Weighted mean (#140); with equal weights exactly the plain mean.
        const weightSum = rows.reduce((a, s) => a + voiceWeight(config, s.evaluatorParticipantId), 0);
        const mean = rows.reduce((a, s) => a + s.score * voiceWeight(config, s.evaluatorParticipantId), 0) / weightSum;
        criterionMeans[criterion] = roundScore(mean);
        criterionSpread[criterion] = Math.max(...values) - Math.min(...values);
        total += (mean * config.weights[criterion]) / 100;
      }
      const reasons: string[] = [];
      if (!complete) reasons.push("Missing independent scores");
      const security = criterionMeans.security;
      if (security !== undefined && security < config.minSecurityScore) reasons.push(`Security score ${security} below minimum ${config.minSecurityScore}`);
      const blocking = objections.filter(
        (o) => o.proposalId === proposalId && o.blocking && (o.status === "open" || o.status === "unresolved" || o.status === "accepted"),
      );
      if (blocking.length > 0) reasons.push(`${blocking.length} unresolved blocking objection(s)`);
      const roundedTotal = complete ? roundScore(total) : null;
      if (roundedTotal !== null && roundedTotal < config.minTotalScore) reasons.push(`Total ${roundedTotal} below minimum ${config.minTotalScore}`);
      // Feasibility is a gate of its own, separate from the quality scores (#121). Gate version 2: the S1 result.
      let implementable: boolean;
      let requirementChecks: { failed: number; total: number };
      if (gate) {
        const entry = gate.proposals.find((g) => g.proposalId === proposalId);
        implementable = entry?.feasibility === "qualified";
        requirementChecks = { failed: entry?.failedRequirements ?? 0, total: entry?.requirements ?? 0 };
        if (!entry) reasons.push("Not qualified: the proposal is missing from the requirement gate");
        else if (!implementable) reasons.push(...entry.causes.map((cause) => `Not qualified: ${cause}`));
      } else {
        const checks = votes
          .filter((v) => groupOf(config, v.evaluatorParticipantId) !== groupOf(config, authorParticipantId))
          .flatMap((v) => (v.requirementChecks ?? []).filter((c) => c.proposalId === proposalId).slice(0, 1));
        const failed = checks.filter((c) => !c.meets).length;
        const declaredUnsolvable = solvesRequirements === false;
        implementable = !declaredUnsolvable && failed * 2 <= checks.length;
        requirementChecks = { failed, total: checks.length };
        if (declaredUnsolvable) reasons.push("Not an implementable solution: the proposal itself states that the hard requirements cannot be met together");
        if (failed * 2 > checks.length)
          reasons.push(`Not an implementable solution: ${failed} of ${checks.length} independent evaluators found a hard requirement unmet`);
      }
      return {
        proposalId,
        criterionMeans,
        criterionSpread,
        total: roundedTotal,
        independentEvaluators: evaluators,
        expectedEvaluators: participantIds
          ? new Set(participantIds.filter((id) => groupOf(config, id) !== groupOf(config, authorParticipantId)).map((id) => groupOf(config, id))).size
          : null,
        implementable,
        requirementChecks,
        securityBelowMinimum: security !== undefined && security < config.minSecurityScore,
        eligible: reasons.length === 0,
        ineligibleReasons: reasons,
        bordaPoints: roundScore(borda.get(proposalId) ?? 0),
      };
    });

  const bordaMax = Math.max(0, ...results.map((r) => r.bordaPoints));
  const bordaLeaders = results.filter((r) => r.bordaPoints === bordaMax && bordaMax > 0);
  const majorityVoteWinnerId = bordaLeaders.length === 1 ? bordaLeaders[0]!.proposalId : null;
  const voteWeights =
    config.evaluatorWeights && Object.keys(config.evaluatorWeights).length ? `; evaluator vote weights ${JSON.stringify(config.evaluatorWeights)}` : "";
  const formula = `total = Σ ${voteWeights ? "vote-weighted " : ""}mean_independent_score(criterion) × weight(criterion) / 100; weights ${JSON.stringify(config.weights)}${voteWeights}`;

  const coverageIssues: ConfidenceIssue[] = [
    ...results
      .filter((r) => r.expectedEvaluators !== null && r.independentEvaluators < r.expectedEvaluators)
      .map(
        (r): ConfidenceIssue => ({
          kind: "missing_evaluators",
          proposalId: r.proposalId,
          evaluators: r.independentEvaluators,
          expected: r.expectedEvaluators!,
        }),
      ),
    ...results
      .filter((r) => r.independentEvaluators === 1 && r.expectedEvaluators !== null && r.expectedEvaluators <= 1)
      .map((r): ConfidenceIssue => ({ kind: "single_evaluator", proposalId: r.proposalId })),
    ...results
      .filter((r) => !gate && r.implementable && r.requirementChecks.failed > 0 && r.requirementChecks.failed * 2 === r.requirementChecks.total)
      .map((r): ConfidenceIssue => ({ kind: "requirements_disputed", proposalId: r.proposalId, ...r.requirementChecks })),
  ];
  // Version 2 never claims that the requirements cannot be met together: FAIL is a judgement about these proposals (#181).
  const requirementsConflict = !gate && results.length > 0 && results.every((r) => !r.implementable);
  const finish = (outcome: VerdictOutcome, recommendedProposalId: string | null, tiedProposalIds: string[]): VerdictResult => {
    const issues = [...coverageIssues, ...extraIssues];
    if (recommendedProposalId && majorityVoteWinnerId && majorityVoteWinnerId !== recommendedProposalId)
      issues.push({ kind: "vote_disagrees", majorityVoteWinnerId });
    return {
      outcome,
      recommendedProposalId,
      tiedProposalIds,
      proposals: results,
      majorityVoteWinnerId,
      formula,
      confidence: confidenceOf(issues),
      confidenceIssues: issues,
      requirementsConflict,
    };
  };

  if (results.every((r) => r.independentEvaluators === 0)) return finish("insufficient_evidence", null, []);
  // A verdict that rests on fewer than half of the expected evaluators is not a council decision (#145).
  if (participantIds) {
    const expected = participantIds.filter((id) => proposals.some((p) => p.authorParticipantId !== id)).length;
    const delivered = new Set(independent.map((s) => s.evaluatorParticipantId)).size;
    if (expected > 0 && delivered * 2 < expected) {
      coverageIssues.push({ kind: "insufficient_evaluators", evaluators: delivered, expected });
      return finish("insufficient_evidence", null, []);
    }
  }
  const eligible = results.filter((r) => r.eligible).sort((a, b) => b.total! - a.total! || a.proposalId.localeCompare(b.proposalId));
  if (gate) {
    // Priority of the S1 outcome (#181): candidates first, then needs_verification, then no_qualifying_solution. No
    // automatic recommendation – and no "no qualifying solution" either – when the proposals were not compared on
    // equal terms: the missing statements could change the result.
    if (!gate.comparisonComplete) {
      coverageIssues.push({ kind: "comparison_incomplete", note: gate.comparisonNote ?? "The proposals were not compared on equal terms." });
      return finish("needs_verification", null, []);
    }
    if (eligible.length === 0)
      return finish(gate.proposals.some((g) => g.feasibility === "needs_verification") ? "needs_verification" : "no_qualifying_solution", null, []);
    const author = proposals.find((p) => p.proposalId === eligible[0]!.proposalId)!.authorParticipantId;
    const blocked = results.find(
      (r) =>
        r.total !== null &&
        hundredths(r.total) > hundredths(eligible[0]!.total!) &&
        gate.proposals.find((g) => g.proposalId === r.proposalId)?.soleBlocker === author,
    );
    if (blocked) {
      coverageIssues.push({ kind: "conflict_of_interest", proposalId: eligible[0]!.proposalId, blockedProposalId: blocked.proposalId });
      return finish("needs_verification", null, []);
    }
  }
  if (eligible.length === 0) return finish("no_qualifying_solution", null, []);
  const best = eligible[0]!;
  // Compared in hundredths: 9.28 − 9.03 is exactly the margin 0.25, not a tie (in binary it is 0.2499…).
  const tied = eligible.filter((r) => hundredths(best.total!) - hundredths(r.total!) < hundredths(config.tieMargin));
  if (tied.length > 1)
    return finish(
      "tie",
      null,
      tied.map((r) => r.proposalId),
    );
  return finish("recommended", best.proposalId, []);
}

/**
 * Whether a stored decision matrix allows approving `proposalId` for implementation (#121). Matrices from runs
 * before the feasibility check have no `implementable` field and stay approvable as before.
 */
export function isImplementable(matrix: unknown, proposalId: string): boolean {
  const proposals = (matrix as { proposals?: Array<{ proposalId: string; implementable?: boolean }> } | null)?.proposals ?? [];
  return proposals.find((p) => p.proposalId === proposalId)?.implementable !== false;
}

export const NOT_IMPLEMENTABLE_MESSAGE =
  "This proposal is a finding that the hard requirements cannot be met, not an implementable solution. Record the finding with Reject, or start a new council with changed requirements.";

/** One wording for every surface (Final Verdict, export, Markdown report) so they explain the same thing. */
export function describeConfidenceIssue(issue: ConfidenceIssue, label: (proposalId: string) => string): string {
  switch (issue.kind) {
    case "missing_evaluators":
      return `Proposal ${label(issue.proposalId)} was scored by ${issue.evaluators} of ${issue.expected} expected evaluators`;
    case "vote_disagrees":
      return `The majority vote favours Proposal ${label(issue.majorityVoteWinnerId)}, not the highest weighted score`;
    case "participant_failed":
      return `${issue.modelId} dropped out of the council (${issue.reason}); its proposal, critiques and scores are missing`;
    case "unreviewed_objections":
      return `${issue.count} objection${issue.count === 1 ? "" : "s"} could not be checked by an independent reviewer and stay${issue.count === 1 ? "s" : ""} open`;
    case "single_evaluator":
      return `Proposal ${label(issue.proposalId)} was scored by a single independent evaluator (only two active models)`;
    case "requirements_disputed":
      return `${issue.failed} of ${issue.total} independent evaluators found that Proposal ${label(issue.proposalId)} misses a hard requirement`;
    case "insufficient_evaluators":
      return `Only ${issue.evaluators} of ${issue.expected} expected evaluators delivered usable scores – too few for a council decision; repeat the evaluation`;
    case "no_debate_contribution":
      return `${issue.modelId} contributed no role review to the 12 Minds Council (every call failed); its perspectives are missing from the debate, but its vote still counts in the Final Verdict if it evaluated`;
    case "undefended_proposal":
      return `Proposal ${label(issue.proposalId)} was not defended – ${issue.reason}: ${issue.count} objection${issue.count === 1 ? "" : "s"} against it stay${issue.count === 1 ? "s" : ""} unanswered, which is not the same as uncontested criticism`;
    case "phase_shortened":
      return `${PHASE_NAMES[issue.phase] ?? issue.phase} was shortened to keep the token budget for the Final Verdict; the verdict is based on the revisions available at that point`;
    case "weighting_changed_winner":
      return `The vote weights decided the outcome: with equal weights the council would ${issue.unweightedWinnerId ? `recommend Proposal ${label(issue.unweightedWinnerId)}` : issue.unweightedOutcome === "tie" ? "end in a tie" : "recommend no proposal"}${issue.weightedWinnerId ? `, weighted it recommends Proposal ${label(issue.weightedWinnerId)}` : ""}`;
    case "comparison_incomplete":
      return issue.note;
    case "conflict_of_interest":
      return `Proposal ${label(issue.blockedProposalId)} scored higher but is blocked only by the requirement checks of the author of Proposal ${label(issue.proposalId)} – a decision in its own favour, so no automatic recommendation`;
    case "evaluation_rejected":
      return `${issue.count} evaluator${issue.count === 1 ? "" : "s"} restated another proposal's title for Proposal ${label(issue.proposalId)}; ${issue.count === 1 ? "its" : "their"} scores for it were dropped`;
  }
}
