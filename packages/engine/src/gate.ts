/**
 * S1 requirement gate (#181, gate version 2). PRIVATE – never publish.
 *
 * Per proposal p with expected evaluators E(p) (frozen, n = |E(p)|) and per confirmed requirement:
 *   counting statement of an evaluator e in E(p) (valid checks only):
 *     any FAIL                                    -> FAIL (also PASS given -> conflict, still FAIL)
 *     only PASS, each with allPartsMet true and evidence -> PASS
 *     anything else stated (UNKNOWN, PASS without allPartsMet or evidence, PASS + UNKNOWN) -> UNKNOWN
 *     nothing valid                               -> open
 *   PASS      all n evaluators PASS (n > 0)
 *   FAIL      at least one FAIL and PASS no strict majority of n
 *   DISPUTED  at least one FAIL and PASS a strict majority of n
 *   UNKNOWN   otherwise (open or UNKNOWN statements, no FAIL)
 * Proposal: incomplete > fail > needs_verification > qualified. The author's own "does not solve the requirements" is
 * NOT a veto (that self-disqualification is what #181 fixes): it decides nothing when every expected evaluator confirmed
 * every requirement, and is named as a cause when the proposal is not qualified anyway. No wording ever claims that the
 * requirements cannot be met together – FAIL is a model judgement about these proposals, not a proof.
 * Checks count only for the frozen revision of the round (fail closed on any other revision).
 */
import type { GateInput, GateMeasure, GateProposalResult, GateRequirementResult, GateResult, RawRequirementCheck, RequirementStatus } from "../contract";

type Statement = "PASS" | "FAIL" | "UNKNOWN" | "open";

function statementOf(checks: RawRequirementCheck[]): { statement: Statement; conflict: boolean } {
  if (checks.length === 0) return { statement: "open", conflict: false };
  const hasFail = checks.some((c) => c.status === "FAIL");
  const hasPass = checks.some((c) => c.status === "PASS");
  if (hasFail) return { statement: "FAIL", conflict: hasPass };
  const onlyPass = checks.every((c) => c.status === "PASS");
  // Every PASS of this evaluator must confirm every part with a reason: one partial PASS next to a full one is UNKNOWN.
  const confirmed = checks.every((c) => c.allPartsMet === true && c.evidence.trim().length > 0);
  return { statement: onlyPass && confirmed ? "PASS" : "UNKNOWN", conflict: false };
}

function statusOf(n: number, pass: number, fail: number): RequirementStatus {
  if (n > 0 && pass === n) return "PASS";
  if (fail > 0) return pass * 2 > n ? "DISPUTED" : "FAIL";
  return "UNKNOWN";
}

/**
 * #249 (owner decision 30.10.26): a recommendation needs at least two independent evaluators per proposal. Self-
 * improvement council 30.10.: one model dropped out in the first phase, each proposal kept one evaluator, and the
 * verdict still read "recommended". Below this breadth a proposal that passed every check is only a provisional
 * favourite (limited review) – never qualified, so never approvable or buildable.
 */
export const MIN_INDEPENDENT_EVALUATORS = 2;

function feasibilityOf(content: unknown, n: number, statuses: RequirementStatus[]): GateProposalResult["feasibility"] {
  if (formallyIncomplete(content)) return "incomplete";
  if (statuses.some((s) => s === "FAIL")) return "fail";
  if (n < MIN_INDEPENDENT_EVALUATORS || statuses.some((s) => s !== "PASS")) return "needs_verification";
  return "qualified";
}

/**
 * Measured requirement (contract 3, owner decision 30.10.26): the statement comes from the evaluator's estimate range.
 * max: high <= limit -> PASS, low > limit -> FAIL, a range across the limit -> UNKNOWN (min mirrored). Strict: PASS only
 * when even the unfavourable end of the range keeps the limit. A missing or malformed estimate is UNKNOWN, and an
 * evaluator's own FAIL always stays FAIL – a number never weakens a stated objection.
 */
function validEstimate(c: RawRequirementCheck): { low: number; high: number } | null {
  const e = c.estimate;
  if (!e || !Number.isFinite(e.low) || !Number.isFinite(e.high)) return null;
  // Test case 30.10.26: for availability a model gave "best case" 99.9 as low and "worst case" 99.3 as high.
  // A reversed range is still one unambiguous interval.
  const low = Math.min(e.low, e.high);
  const high = Math.max(e.low, e.high);
  return low < 0 ? null : { low, high };
}

/** #226: a strict limit ("below 150") is missed by an estimate that reaches the value itself. */
function rangeVsLimit(e: { low: number; high: number }, m: GateMeasure): "within" | "beyond" | "across" {
  const within = m.direction === "max" ? (m.strict ? e.high < m.value : e.high <= m.value) : m.strict ? e.low > m.value : e.low >= m.value;
  const beyond = m.direction === "max" ? (m.strict ? e.low >= m.value : e.low > m.value) : m.strict ? e.high <= m.value : e.high < m.value;
  return within ? "within" : beyond ? "beyond" : "across";
}

function measuredCheck(c: RawRequirementCheck, m: GateMeasure): RawRequirementCheck {
  if (c.status === "FAIL") return c;
  const e = validEstimate(c);
  if (!e) return { ...c, status: "UNKNOWN" };
  const side = rangeVsLimit(e, m);
  return { ...c, status: side === "within" ? "PASS" : side === "beyond" ? "FAIL" : "UNKNOWN", allPartsMet: side === "within" ? true : c.allPartsMet };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

function requirementResult(requirementId: string, expected: string[], raw: RawRequirementCheck[], measure?: GateMeasure): GateRequirementResult {
  const checks = measure ? raw.map((c) => measuredCheck(c, measure)) : raw;
  const pass: string[] = [];
  const fail: string[] = [];
  const unknown: string[] = [];
  const open: string[] = [];
  const conflicts: string[] = [];
  for (const evaluator of expected) {
    const own = checks.filter((c) => c.evaluatorParticipantId === evaluator);
    const { statement, conflict } = statementOf(own);
    if (conflict) conflicts.push(evaluator);
    if (statement === "PASS") pass.push(evaluator);
    else if (statement === "FAIL") fail.push(evaluator);
    else if (statement === "UNKNOWN") unknown.push(evaluator);
    else open.push(evaluator);
  }
  const result: GateRequirementResult = { requirementId, status: statusOf(expected.length, pass.length, fail.length), pass, fail, unknown, open, conflicts };
  if (measure) {
    // One range per evaluator (its widest stated range), so a repeated check does not count twice in the median.
    const ranges = expected.flatMap((evaluator) => {
      const own = raw.filter((c) => c.evaluatorParticipantId === evaluator).map(validEstimate).filter((e): e is { low: number; high: number } => e !== null);
      return own.length ? [{ low: Math.min(...own.map((e) => e.low)), high: Math.max(...own.map((e) => e.high)) }] : [];
    });
    // Why an UNKNOWN evaluator is UNKNOWN: its range crosses the limit, or it gave no usable estimate at all.
    const unknownSet = new Set(unknown);
    const crosses = (e: { low: number; high: number } | null) => e !== null && rangeVsLimit(e, measure) === "across";
    const straddling = expected.filter(
      (evaluator) => unknownSet.has(evaluator) && raw.some((c) => c.evaluatorParticipantId === evaluator && c.status !== "FAIL" && crosses(validEstimate(c))),
    ).length;
    result.estimate = ranges.length
      ? {
          low: Math.min(...ranges.map((r) => r.low)),
          high: Math.max(...ranges.map((r) => r.high)),
          median: median(ranges.map((r) => (r.low + r.high) / 2)),
          evaluators: ranges.length,
          limit: measure,
          straddling,
          withoutEstimate: unknown.length - straddling,
        }
      : null;
  }
  return result;
}

/** Formal completeness only: an empty architecture or no named component is not a buildable draft. */
function formallyIncomplete(content: unknown): boolean {
  const c = (content ?? {}) as { architecture?: unknown; components?: unknown };
  const architecture = typeof c.architecture === "string" ? c.architecture.trim() : "";
  const components = Array.isArray(c.components) ? c.components.filter((x) => typeof x === "string" && x.trim().length > 0) : [];
  return architecture.length === 0 || components.length === 0;
}

/**
 * The number as the evaluator gave it (#226): never rounded or cut across a limit – 99.95 % must not read "100",
 * 150.004 not "150". Only binary noise is removed (0.1 + 0.2 reads 0.3).
 */
const exact = (x: number) => String(Number(x.toPrecision(12)));
function rangeText(e: NonNullable<GateRequirementResult["estimate"]>): string {
  const unit = e.limit.unit === "%" ? " %" : e.limit.unit === "EUR/month" ? " EUR per month" : ` ${e.limit.unit}`;
  const relation = e.limit.direction === "max" ? (e.limit.strict ? "below" : "at most") : e.limit.strict ? "above" : "at least";
  const limit = `${relation} ${e.limit.value}${unit}`;
  return `estimates ${exact(e.low)}–${exact(e.high)}${unit} (median ${exact(e.median)}), limit ${limit}`;
}

function causesOf(requirements: GateRequirementResult[], n: number): string[] {
  const causes: string[] = [];
  for (const r of requirements) {
    if (r.estimate && r.status !== "PASS") {
      const e = r.estimate;
      // Measured requirement: the numbers say why (model estimates, not a guarantee).
      const who = r.status === "FAIL" || r.status === "DISPUTED" ? `${r.fail.length} of ${n} evaluators expect the limit to be missed` : null;
      const parts = [
        who,
        e.straddling ? `${e.straddling} of ${n} evaluators' ranges reach across the limit` : null,
        e.withoutEstimate ? `${e.withoutEstimate} of ${n} evaluators gave no usable estimate` : null,
        r.open.length ? `${r.open.length} of ${n} evaluators gave no valid answer` : null,
      ].filter(Boolean);
      causes.push(`${r.requirementId} ${r.status === "FAIL" ? "not met" : r.status === "DISPUTED" ? "disputed" : "not confirmed"}: ${rangeText(r.estimate)}; ${parts.join("; ")} (model estimates).`);
      continue;
    }
    if (r.status === "FAIL") causes.push(`${r.requirementId} not met according to ${r.fail.length} of ${n} evaluators (model judgement).`);
    else if (r.status === "DISPUTED")
      causes.push(`${r.requirementId} disputed: ${r.pass.length} of ${n} evaluators confirm it, ${r.fail.length} found it not met.`);
    else if (r.status === "UNKNOWN") {
      // Named separately (#181 live test): "could not confirm" is a stated judgement, "no valid answer" a missing check.
      const parts = [
        r.unknown.length ? `${r.unknown.length} of ${n} evaluators could not confirm it` : null,
        r.open.length ? `${r.open.length} of ${n} evaluators gave no valid answer` : null,
      ].filter(Boolean);
      causes.push(`${r.requirementId} not confirmed: ${parts.join("; ")}.`);
    }
  }
  return causes;
}

export function evaluateGate({ round, checks, deliveredEvaluatorIds }: GateInput): GateResult {
  const requirementIds = [...new Set(round.requirementIds)];
  const evaluated = round.proposals.map((p) => {
    const expected = [...new Set(p.expectedEvaluatorIds.filter((id) => id !== p.authorParticipantId))];
    const counted = checks.filter(
      (c) => c.valid && c.proposalId === p.proposalId && c.revisionId === p.revisionId && expected.includes(c.evaluatorParticipantId),
    );
    const requirements = requirementIds.map((id) =>
      requirementResult(
        id,
        expected,
        counted.filter((c) => c.requirementId === id),
        round.measures?.[id],
      ),
    );
    const authorDeclines = (p.content as { solvesRequirements?: unknown } | null)?.solvesRequirements === false;
    const causes: string[] = [];
    const feasibility = feasibilityOf(
      p.content,
      expected.length,
      requirements.map((r) => r.status),
    );
    if (feasibility === "incomplete") causes.push("Incomplete draft: no architecture or no named components – nothing that could be built.");
    else causes.push(...causesOf(requirements, expected.length));
    if (expected.length === 0) causes.push("No independent evaluator was expected for this proposal.");
    // Every check passed, but too few evaluators gave them: the only reason this proposal is not qualified.
    const limitedReview =
      feasibility === "needs_verification" && expected.length > 0 && requirements.length > 0 && requirements.every((r) => r.status === "PASS");
    if (limitedReview)
      causes.push(
        `Limited review: only ${expected.length} independent evaluator checked this proposal and confirmed every requirement; a recommendation needs at least ${MIN_INDEPENDENT_EVALUATORS}.`,
      );
    if (authorDeclines) causes.push("The author states that this proposal does not meet every requirement (not decisive on its own).");
    // Conflict-of-interest signal: every non-PASS statement of a not-qualified proposal comes from one evaluator and
    // nothing is open. The verdict uses it when that evaluator authored the proposal that would win instead. The
    // author's own "does not solve" does not switch this protection off – otherwise it would be a veto again (#181).
    const blockers = new Set(requirements.flatMap((r) => (r.status === "PASS" ? [] : [...r.fail, ...r.unknown])));
    const soleBlocker =
      (feasibility === "fail" || feasibility === "needs_verification") && blockers.size === 1 && requirements.every((r) => r.open.length === 0)
        ? [...blockers][0]!
        : null;
    // Would the missing statements change the result if they were given as PASS? Then this proposal was not compared
    // on equal terms – also when its evaluators delivered an evaluation but left checks for it out.
    const bestCase = feasibilityOf(
      p.content,
      expected.length,
      requirements.map((r) => statusOf(expected.length, r.pass.length + r.open.length, r.fail.length)),
    );
    const openEvaluators = bestCase === feasibility ? [] : [...new Set(requirements.flatMap((r) => r.open))];
    return {
      result: { proposalId: p.proposalId, feasibility, requirements, causes: feasibility === "qualified" ? [] : causes, soleBlocker, limitedReview },
      openEvaluators,
    };
  });

  // Equal terms: every proposal that could still be chosen was evaluated by all of its expected evaluators. A missing
  // evaluator must not hand an advantage to the proposal it could not evaluate (its own) – no automatic winner then.
  const proposals: GateProposalResult[] = evaluated.map((e) => e.result);
  const delivered = new Set(deliveredEvaluatorIds);
  const missing = new Set<string>(evaluated.flatMap((e) => e.openEvaluators));
  for (const p of round.proposals) {
    const result = proposals.find((r) => r.proposalId === p.proposalId)!;
    if (result.feasibility === "fail" || result.feasibility === "incomplete") continue;
    for (const id of p.expectedEvaluatorIds) if (id !== p.authorParticipantId && !delivered.has(id)) missing.add(id);
  }
  const comparisonComplete = missing.size === 0;
  return {
    proposals,
    comparisonComplete,
    comparisonNote: comparisonComplete
      ? null
      : `Comparison incomplete: ${missing.size} expected evaluator${missing.size === 1 ? "" : "s"} delivered no evaluation or left checks out, so the proposals were not compared on equal terms. No automatic recommendation.`,
    summary: summaryOf(proposals),
  };
}

/**
 * #230 (first GPT-1 run): "none meets all requirements" was the first line also when one evaluator's answer was lost
 * and nothing was found unmet. "Not confirmed" is not "not met", and neither is a statement about all possible solutions.
 */
function summaryOf(proposals: GateProposalResult[]): string | null {
  if (proposals.some((p) => p.feasibility === "qualified")) return null;
  const limited = proposals.filter((p) => p.limitedReview).length;
  const breadth =
    limited > 0
      ? `${limited === 1 ? "1 proposal" : `${limited} proposals`} passed every check, but too few independent evaluators took part (at least ${MIN_INDEPENDENT_EVALUATORS} per proposal are needed for a recommendation): ${limited === 1 ? "a provisional favourite" : "provisional favourites"}, not a recommendation. `
      : "";
  const text = summaryText(proposals);
  return text ? breadth + text : breadth.trim() || null;
}

function summaryText(all: GateProposalResult[]): string | null {
  // A provisional favourite is named in its own sentence; the rest speaks about the other proposals only.
  const proposals = all.filter((p) => !p.limitedReview);
  if (proposals.length === 0) return null;
  const other = proposals.length < all.length ? "other " : "";
  const unmet = proposals.filter((p) => p.feasibility === "fail").length;
  const open = proposals.filter((p) => p.feasibility === "needs_verification").length;
  if (open === 0) return `None of the ${other}evaluated proposals meets all confirmed requirements according to these evaluations.`;
  const n = proposals.length;
  if (unmet === 0)
    return `None of the ${n} ${other}evaluated proposals could be confirmed against all requirements: the evaluations leave requirements open. Not confirmed is not the same as not met.`;
  return `${unmet} of ${n} ${other}evaluated proposals miss a confirmed requirement according to these evaluations; ${open} could not be confirmed (not confirmed is not the same as not met).`;
}
