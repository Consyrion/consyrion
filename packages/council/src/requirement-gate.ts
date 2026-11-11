import { groupsOf } from "./independence";
import { DomainError, MEASUREMENT_CHECK_GATE_VERSION, requirementVerification } from "@consyrium/core";
import { newId, schema } from "@consyrium/db";
import { engine } from "@consyrium/engine";
import type { GateResult, RawRequirementCheck } from "@consyrium/engine/contract";
import { and, asc, eq } from "drizzle-orm";
import type { SessionContext } from "./context";
import { mergeFollowUpChecks } from "./follow-up";

/**
 * Orchestration of the S1 requirement gate (#181, gate version 2). The rules live in the engine (#188); this
 * module only freezes the round, stores raw checks and hands both to the engine.
 */

export type EvaluationRound = typeof schema.evaluationRound.$inferSelect;

/**
 * The frozen round of this session, created before the first Final Verdict call: requirement ids of the confirmed
 * list, the revision per proposal and E(p) = participants active now, without the author. Created once (unique per
 * session and round) and reused on every resume, so a later dropout never shrinks E(p).
 */
export async function ensureEvaluationRound(ctx: SessionContext): Promise<EvaluationRound> {
  const existing = await loadEvaluationRound(ctx);
  if (existing) return existing;
  const listId = ctx.session.requirementListId;
  if (!listId) throw new DomainError("CONFLICT", "This council has no confirmed requirement list; the requirement gate cannot run.");
  const [list] = await ctx.db.select().from(schema.requirementList).where(eq(schema.requirementList.id, listId));
  if (!list) throw new DomainError("CONFLICT", "The confirmed requirement list of this council is missing.");
  const proposals = await ctx.proposals();
  const participants = await ctx.participants();
  const active = participants.map((p) => p.id);
  // User decision 08.11.26: an instance of the author's model (same independence group, another key) is never a
  // foreign evaluator of that proposal – frozen here, the engine filters again.
  const group = groupsOf(participants);
  await ctx.db
    .insert(schema.evaluationRound)
    .values({
      id: newId("rnd"),
      organizationId: ctx.orgId,
      sessionId: ctx.session.id,
      round: 1,
      requirementListId: list.id,
      requirementIds: list.items.map((item) => item.id),
      proposals: proposals.map((p) => ({
        proposalId: p.proposal.id,
        revisionId: p.latest.id,
        authorParticipantId: p.proposal.authorParticipantId,
        expectedEvaluatorIds: active.filter((id) => id !== p.proposal.authorParticipantId && group[id] !== group[p.proposal.authorParticipantId]),
      })),
    })
    .onConflictDoNothing();
  return (await loadEvaluationRound(ctx))!;
}

export async function loadEvaluationRound(ctx: SessionContext): Promise<EvaluationRound | null> {
  const [round] = await ctx.db
    .select()
    .from(schema.evaluationRound)
    .where(and(eq(schema.evaluationRound.sessionId, ctx.session.id), eq(schema.evaluationRound.round, 1)));
  return round ?? null;
}

/** Every evaluator expected for at least one proposal of the round. */
export function roundEvaluators(round: EvaluationRound): Set<string> {
  return new Set(round.proposals.flatMap((p) => p.expectedEvaluatorIds));
}

type CheckAnswer = {
  requirementId: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  allPartsMet: boolean;
  evidence: string;
  estimateLow?: number | null;
  estimateHigh?: number | null;
};

const finite = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
/** Test case 30.10.26: for availability a model gave its best case (99.9) as low and its worst (99.3) as high – store the interval in order. */
function orderedRange(a: number | null | undefined, b: number | null | undefined): [number | null, number | null] {
  const low = finite(a);
  const high = finite(b);
  return low !== null && high !== null && low > high ? [high, low] : [low, high];
}

/**
 * Rows for every requirement check of one evaluator's answer – all of them, also duplicates and contradictions
 * (append-only). A check counts only when it is bound to a proposal of the round the evaluator is expected for, to the
 * revision of the round and to a requirement id of the round's list; otherwise it is stored with the reason. In a split
 * evaluation (#246) `scope` holds the requirement ids of this call: a check of an id that belongs to another call is
 * stored as invalid, so every requirement counts from exactly one call – the same checks as one unsplit answer.
 */
export function requirementCheckRows(
  ctx: SessionContext,
  round: EvaluationRound,
  evaluatorParticipantId: string,
  evaluations: ReadonlyArray<{ proposalId: string | null; revisionId: string | null; rejected: boolean; checks: ReadonlyArray<CheckAnswer> }>,
  scope?: ReadonlySet<string>,
): (typeof schema.requirementCheck.$inferInsert)[] {
  const ids = new Set(round.requirementIds);
  return evaluations.flatMap((evaluation) => {
    const entry = round.proposals.find((p) => p.proposalId === evaluation.proposalId);
    return evaluation.checks.map((check) => {
      const requirementId = check.requirementId.trim().toUpperCase();
      const invalidReason = evaluation.rejected
        ? "evaluation bound to another proposal (title or summary mismatch)"
        : !entry
          ? "proposal is not part of the evaluation round"
          : !entry.expectedEvaluatorIds.includes(evaluatorParticipantId)
            ? "evaluator is not an expected evaluator of this proposal"
            : evaluation.revisionId !== entry.revisionId
              ? "check refers to another revision than the evaluation round"
              : !ids.has(requirementId)
                ? "requirement id is not part of the confirmed list of this round"
                : scope && !scope.has(requirementId)
                  ? "requirement id belongs to another call of this split evaluation"
                  : null;
      return {
        id: newId("rqc"),
        organizationId: ctx.orgId,
        sessionId: ctx.session.id,
        roundId: round.id,
        evaluatorParticipantId,
        proposalId: evaluation.proposalId ?? "",
        revisionId: evaluation.revisionId ?? "",
        requirementId,
        status: check.status,
        allPartsMet: check.allPartsMet,
        evidence: check.evidence,
        estimateLow: orderedRange(check.estimateLow, check.estimateHigh)[0],
        estimateHigh: orderedRange(check.estimateLow, check.estimateHigh)[1],
        valid: invalidReason === null,
        invalidReason,
      };
    });
  });
}

/** Runs the engine's gate on the frozen round and the stored raw checks. */
export async function evaluateRequirementGate(ctx: SessionContext, round: EvaluationRound, deliveredEvaluatorIds: string[]): Promise<GateResult> {
  const baseRows = await ctx.db
    .select()
    .from(schema.requirementCheck)
    .where(eq(schema.requirementCheck.roundId, round.id))
    .orderBy(asc(schema.requirementCheck.createdAt), asc(schema.requirementCheck.id));
  // #228/#229: finished follow-up rounds fill missing or UNKNOWN checks of the same evaluator – a FAIL always stays.
  const followUps = await ctx.db
    .select()
    .from(schema.evaluationRound)
    .where(and(eq(schema.evaluationRound.parentRoundId, round.id), eq(schema.evaluationRound.status, "done")))
    .orderBy(asc(schema.evaluationRound.round));
  const rows = followUps.length
    ? mergeFollowUpChecks(
        baseRows,
        await Promise.all(
          followUps.map(async (f) => ({
            items: f.items ?? [],
            rows: await ctx.db
              .select()
              .from(schema.requirementCheck)
              .where(eq(schema.requirementCheck.roundId, f.id))
              .orderBy(asc(schema.requirementCheck.createdAt), asc(schema.requirementCheck.id)),
          })),
        ),
      )
    : baseRows;
  const revisions = await Promise.all(
    round.proposals.map(async (p) => (await ctx.db.select().from(schema.proposalRevision).where(eq(schema.proposalRevision.id, p.revisionId)))[0]),
  );
  const checks: RawRequirementCheck[] = rows.map((r) => ({
    evaluatorParticipantId: r.evaluatorParticipantId,
    proposalId: r.proposalId,
    revisionId: r.revisionId,
    requirementId: r.requirementId,
    status: r.status,
    allPartsMet: r.allPartsMet,
    evidence: r.evidence,
    valid: r.valid,
    estimate: r.estimateLow !== null && r.estimateHigh !== null ? { low: r.estimateLow, high: r.estimateHigh } : null,
  }));
  // Measured requirements of the round's (immutable) confirmed list; rounds keep their list, so this never changes.
  const [list] = await ctx.db.select().from(schema.requirementList).where(eq(schema.requirementList.id, round.requirementListId));
  const measures = Object.fromEntries(
    (list?.items ?? []).filter((item) => item.measure && round.requirementIds.includes(item.id)).map((item) => [item.id, item.measure!]),
  );
  const buildChecks = (list?.items ?? []).filter((item) => item.verification === "build" && round.requirementIds.includes(item.id)).map((item) => item.id);
  // #249 part 2: from gate version 3 the round names its measurement checks (possibly none); version 2 passes nothing.
  const measurementChecks =
    ctx.session.gateVersion >= MEASUREMENT_CHECK_GATE_VERSION
      ? (list?.items ?? [])
          .filter((item) => round.requirementIds.includes(item.id) && requirementVerification(item, ctx.session.gateVersion) === "measurement")
          .map((item) => item.id)
      : null;
  // Engine contract 6 (user decision 08.11.26): instances of one model are one independent evaluator. The group comes
  // from the participant's stored provider and model id, which never change during a run.
  const participantGroups = groupsOf(await ctx.participants(false));
  const result = engine.evaluateGate({
    round: {
      requirementIds: round.requirementIds,
      participantGroups,
      ...(Object.keys(measures).length ? { measures } : {}),
      ...(buildChecks.length ? { buildChecks } : {}),
      ...(measurementChecks ? { measurementChecks } : {}),
      proposals: round.proposals.map((p, index) => ({
        proposalId: p.proposalId,
        revisionId: p.revisionId,
        authorParticipantId: p.authorParticipantId,
        expectedEvaluatorIds: p.expectedEvaluatorIds,
        content: revisions[index]?.content ?? null,
      })),
    },
    checks,
    deliveredEvaluatorIds,
  });
  assertGateResultConsistent(round, result);
  return result;
}

const FEASIBILITIES = new Set(["qualified", "needs_verification", "fail", "incomplete"]);
const STATUSES = new Set(["PASS", "FAIL", "DISPUTED", "UNKNOWN"]);

/**
 * Structural check of the engine's output before anything is stored (#181 review): every proposal of the round exactly
 * once, every requirement of the round exactly once per proposal, known values, `qualified` only with every requirement
 * PASS. An inconsistent result fails the evaluation (fail closed) instead of being stored as a verdict.
 */
export function assertGateResultConsistent(round: Pick<EvaluationRound, "requirementIds" | "proposals">, result: GateResult): void {
  const fail = (why: string) => {
    throw new DomainError("CONFIGURATION", `The CONSYRIUM engine returned an inconsistent requirement gate result (${why}); no verdict was stored.`);
  };
  if (!result || !Array.isArray(result.proposals) || typeof result.comparisonComplete !== "boolean") fail("shape");
  const roundIds = round.proposals.map((p) => p.proposalId);
  const resultIds = result.proposals.map((p) => p.proposalId);
  if (resultIds.length !== roundIds.length || new Set(resultIds).size !== resultIds.length || roundIds.some((id) => !resultIds.includes(id))) fail("proposals");
  const requirementIds = [...round.requirementIds].sort().join("|");
  for (const p of result.proposals) {
    if (!FEASIBILITIES.has(p.feasibility)) fail("feasibility");
    if (!Array.isArray(p.requirements) || !Array.isArray(p.causes)) fail("shape");
    const ids = p.requirements.map((r) => r.requirementId);
    if (new Set(ids).size !== ids.length || [...ids].sort().join("|") !== requirementIds) fail("requirements");
    if (p.requirements.some((r) => !STATUSES.has(r.status))) fail("status");
    if (p.feasibility === "qualified" && p.requirements.some((r) => r.status !== "PASS")) fail("qualified without every requirement PASS");
    // #249 part 2: a confirmed measurement plan never qualifies – checked here too, not only trusted from the engine.
    if (p.feasibility === "qualified" && (p.architectureCandidate === true || p.requirements.some((r) => r.measurementPending === true)))
      fail("qualified with an open measurement");
    const expected = round.proposals.find((r) => r.proposalId === p.proposalId)!.expectedEvaluatorIds;
    if (p.soleBlocker !== null && !expected.includes(p.soleBlocker)) fail("blocker");
  }
}

/** The proposals of the round, each with exactly the revision frozen in it – never a later one (#181 review). */
export async function frozenProposals(ctx: SessionContext, round: EvaluationRound) {
  const all = await ctx.proposals();
  return Promise.all(
    round.proposals.map(async (p) => {
      const current = all.find((x) => x.proposal.id === p.proposalId);
      const [revision] = await ctx.db.select().from(schema.proposalRevision).where(eq(schema.proposalRevision.id, p.revisionId));
      if (!current || !revision) throw new DomainError("CONFLICT", "A proposal revision of the frozen evaluation round is missing.");
      return { proposal: current.proposal, latest: revision };
    }),
  );
}

/** The evaluator instruction of the installed engine. */
export function requirementCheckInstruction(): string {
  return engine.requirementCheckInstruction;
}
