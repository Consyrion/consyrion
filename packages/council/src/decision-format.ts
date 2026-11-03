import { DomainError, NOT_IMPLEMENTABLE_MESSAGE } from "@consyrion/core";
import { schema, type Database } from "@consyrion/db";
import { eq } from "drizzle-orm";

/**
 * Decision format / gate versions (#181, stage 1). Server-side only (service, worker, Execution Council, report):
 * clients display the `decisionStatus` the session view returns and never re-implement this check. Kept in this one
 * module so it can move into the engine later (#188).
 *
 * 1 = the feasibility gate of production e33a3bb. Every decision that existed when migration 0021 ran is marked 1
 *     (explicit legacy marking). Councils started before the S1 release (council_session.gate_version 1) still
 *     finish with it.
 * 2 = the S1 requirement gate (#181): new councils are started for it. Feasibility comes only from the private
 *     engine's gate result stored in the matrix; a release that only knows 1 never approves, builds or re-evaluates it.
 *
 * Everything a reader does not know – a higher version, a missing version, an outcome it has no rule for – is
 * "not approvable". Unknown never falls back to the permissive legacy path.
 */
/** Gate version new councils are started for. */
export const GATE_VERSION = 2;
/** Highest gate version this release can evaluate, approve and build. */
export const MAX_SUPPORTED_GATE_VERSION = 2;

/** Outcomes each gate version produces and that a reader may treat as possibly approvable. */
const APPROVABLE_OUTCOMES: Readonly<Record<number, ReadonlySet<string>>> = {
  1: new Set(["recommended", "no_qualifying_solution", "tie", "insufficient_evidence"]),
  2: new Set(["recommended", "no_qualifying_solution", "tie", "insufficient_evidence"]),
};

export interface StoredDecisionLike {
  gateVersion?: number | null;
  outcome: string;
  recommendedProposalId: string | null;
  matrix: unknown;
}

/** Version 2: why a proposal that is not qualified cannot be approved – no claim that the requirements are unsolvable. */
export const NOT_QUALIFIED_MESSAGE =
  "This proposal does not meet every confirmed requirement according to the evaluations (or it could not be confirmed). It cannot be approved or built. Change the brief or the requirements and start a new council.";

/** #249: too few independent evaluators checked the proposal – a provisional favourite, never approvable. */
export const LIMITED_REVIEW_MESSAGE =
  "Too few independent models checked this proposal (at least 2 are needed). It is a provisional favourite and cannot be approved or built. Start a new council with at least 3 models.";

export type DecisionCheck = { ok: true } | { ok: false; reason: string };

/** Neutral user-facing text for outcomes a reader does not treat as approvable (UI, report, delivery). */
export function unapprovableOutcomeText(outcome: string): string {
  return outcome === "needs_verification"
    ? "Needs verification – the council could not confirm that a proposal meets every requirement. It cannot be approved or built."
    : "This verdict uses a result this version does not know. It cannot be approved or built here.";
}

/** Text for a decision whose format version this release cannot read (missing, higher or invalid). */
export function unsupportedGateVersionText(gateVersion: number | null | undefined): string {
  return gateVersion == null
    ? "This verdict carries no format version (written by an outdated release). It cannot be approved or built – repeat the council."
    : `This verdict was computed with gate version ${gateVersion}, which this version does not support. It cannot be approved, built or re-evaluated here.`;
}

/** Whether this release can read the decision's format at all. */
export function isSupportedGateVersion(gateVersion: number | null | undefined): gateVersion is number {
  return typeof gateVersion === "number" && Number.isInteger(gateVersion) && gateVersion >= 1 && gateVersion <= MAX_SUPPORTED_GATE_VERSION;
}

/**
 * Display rule for every reader: a decision is shown as approvable only if its version is supported and its outcome
 * is one the version-1 gate produces. needs_verification and anything unknown are "not approvable".
 */
export function decisionDisplayCheck(decision: Pick<StoredDecisionLike, "gateVersion" | "outcome"> & { matrix?: unknown }): DecisionCheck {
  if (!isSupportedGateVersion(decision.gateVersion)) return { ok: false, reason: unsupportedGateVersionText(decision.gateVersion) };
  // Version 2 rests on the engine's gate result: without it nothing in the matrix is trusted (#181, S1). Fail closed –
  // also when a caller passes no matrix at all.
  if (decision.gateVersion === 2 && !hasRequirementGate(decision.matrix))
    return { ok: false, reason: "The stored verdict has no requirement gate result. It cannot be approved or built." };
  if (!APPROVABLE_OUTCOMES[decision.gateVersion]!.has(decision.outcome)) return { ok: false, reason: unapprovableOutcomeText(decision.outcome) };
  return { ok: true };
}

function hasRequirementGate(matrix: unknown): boolean {
  const gate = (matrix as { requirementGate?: { proposals?: unknown } } | null)?.requirementGate;
  return Array.isArray(gate?.proposals);
}

type MatrixEntry = { proposalId?: unknown; implementable?: unknown; feasibility?: unknown; securityBelowMinimum?: unknown };
type GateEntry = { proposalId?: unknown; feasibility?: unknown; limitedReview?: unknown; requirements?: Array<{ requirementId?: unknown; status?: unknown }> };
type V2Matrix = {
  proposals: MatrixEntry[];
  roundId?: unknown;
  requirementIds?: unknown;
  requirementGate?: { proposals?: GateEntry[]; comparisonComplete?: unknown };
};

/**
 * Version 2: the stored matrix must be internally consistent before anything in it is trusted (#181 review) – a round,
 * the requirement ids, exactly one gate entry per matrix proposal, every requirement once per entry. Structure only;
 * the rules stay in the engine.
 */
function v2MatrixProblem(matrix: V2Matrix): string | null {
  if (typeof matrix.roundId !== "string" || !Array.isArray(matrix.requirementIds)) return "it has no frozen evaluation round";
  const gate = matrix.requirementGate?.proposals;
  if (!Array.isArray(gate)) return "it has no requirement gate result";
  const gateIds = gate.map((g) => g?.proposalId);
  const matrixIds = matrix.proposals.map((p) => p?.proposalId);
  if (new Set(gateIds).size !== gateIds.length || gateIds.length !== matrixIds.length || matrixIds.some((id) => !gateIds.includes(id)))
    return "its requirement gate result does not cover exactly its proposals";
  const required = [...(matrix.requirementIds as unknown[])].map(String).sort().join("|");
  for (const g of gate) {
    // #249: a limited review is never qualified – the engine says so, and this check does not rely on it.
    if (g.limitedReview === true && g.feasibility === "qualified") return "a proposal is marked both qualified and limited review";
    const ids = (Array.isArray(g.requirements) ? g.requirements : []).map((r) => String(r?.requirementId));
    if (new Set(ids).size !== ids.length || [...ids].sort().join("|") !== required)
      return "its requirement gate result does not cover exactly the confirmed requirements";
  }
  return null;
}

/**
 * Server-side check before approve, select_alternative and startExecution. Version 1 keeps today's rule
 * (isImplementable: an entry without the `implementable` field stays approvable, as for runs before #121), but only
 * after the format itself is consistent: supported version, known outcome, a matrix with a proposal list, an entry for
 * the proposal and no contradiction between the row and its matrix.
 */
export function checkDecisionForApproval(decision: StoredDecisionLike, proposalId: string): DecisionCheck {
  const display = decisionDisplayCheck(decision);
  if (!display.ok) return display;
  const matrix = decision.matrix as { outcome?: unknown; recommendedProposalId?: unknown; proposals?: unknown } | null;
  if (!matrix || typeof matrix !== "object" || !Array.isArray(matrix.proposals))
    return { ok: false, reason: "The stored verdict has no evaluation matrix; it cannot be approved or built." };
  if ("outcome" in matrix && matrix.outcome !== decision.outcome)
    return { ok: false, reason: "The stored verdict contradicts itself (outcome); it cannot be approved or built." };
  if ("recommendedProposalId" in matrix && (matrix.recommendedProposalId ?? null) !== decision.recommendedProposalId)
    return { ok: false, reason: "The stored verdict contradicts itself (recommendation); it cannot be approved or built." };
  const entries = (matrix.proposals as MatrixEntry[]).filter((p) => p && p.proposalId === proposalId);
  if (entries.length === 0) return { ok: false, reason: "The proposal is not part of the stored verdict; it cannot be approved or built." };
  if (entries.length > 1) return { ok: false, reason: "The stored verdict lists the proposal twice; it cannot be approved or built." };
  const implementable = entries[0]!.implementable;
  if (decision.gateVersion === 2) {
    // S1: only an entry the engine's gate marked qualified – missing or contradictory fields are refused, never assumed.
    const v2 = matrix as unknown as V2Matrix;
    const problem = v2MatrixProblem(v2);
    if (problem) return { ok: false, reason: `The stored verdict is inconsistent: ${problem}. It cannot be approved or built.` };
    const gateEntry = v2.requirementGate!.proposals!.find((g) => g.proposalId === proposalId)!;
    const allPass = (gateEntry.requirements ?? []).every((r) => r?.status === "PASS");
    if (gateEntry.limitedReview === true) return { ok: false, reason: LIMITED_REVIEW_MESSAGE };
    if (gateEntry.feasibility !== "qualified" || implementable !== true || !allPass)
      return implementable === false && gateEntry.feasibility !== "qualified"
        ? { ok: false, reason: NOT_QUALIFIED_MESSAGE }
        : { ok: false, reason: "The stored verdict contradicts itself (feasibility); it cannot be approved or built." };
    // A binding security minimum is not a preference: no approval and no alternative may override it (#181 review).
    if (entries[0]!.securityBelowMinimum !== false)
      return { ok: false, reason: "This proposal is below the security minimum of the policy (or the verdict does not say); it cannot be approved or built." };
    // A recommendation exists only when the proposals were compared on equal terms.
    if (decision.outcome === "recommended" && decision.recommendedProposalId === proposalId && v2.requirementGate!.comparisonComplete !== true)
      return { ok: false, reason: "The stored verdict contradicts itself (recommendation without a complete comparison); it cannot be approved or built." };
    return { ok: true };
  }
  if (implementable !== undefined && typeof implementable !== "boolean")
    return { ok: false, reason: "The stored verdict has an invalid feasibility field; it cannot be approved or built." };
  if (implementable === false) return { ok: false, reason: NOT_IMPLEMENTABLE_MESSAGE };
  return { ok: true };
}

/**
 * Version 2: the decision must rest on the frozen round of its own session and requirement list – checked against the
 * database at approval and before every build run (#181 review). Version 1 decisions have no round.
 */
export async function assertDecisionRoundBinding(
  db: Database,
  sessionId: string,
  decision: Pick<StoredDecisionLike, "gateVersion" | "matrix"> & { requirementListId: string | null },
): Promise<void> {
  if (decision.gateVersion !== 2) return;
  const matrix = decision.matrix as { roundId?: unknown; requirementIds?: unknown; proposals?: Array<{ proposalId?: unknown }> } | null;
  const refuse = (why: string) => {
    throw new DomainError("CONFLICT", `The stored verdict does not match its evaluation round (${why}). It cannot be approved or built.`);
  };
  if (!matrix || typeof matrix.roundId !== "string") return refuse("no round");
  const [round] = await db.select().from(schema.evaluationRound).where(eq(schema.evaluationRound.id, matrix.roundId));
  if (!round || round.sessionId !== sessionId) return refuse("round of another session");
  if (round.requirementListId !== decision.requirementListId) return refuse("other requirement list");
  const ids = (list: unknown[]) => [...list].map(String).sort().join("|");
  if (!Array.isArray(matrix.requirementIds) || ids(matrix.requirementIds) !== ids(round.requirementIds)) return refuse("other requirements");
  if (ids((matrix.proposals ?? []).map((p) => p.proposalId)) !== ids(round.proposals.map((p) => p.proposalId))) return refuse("other proposals");
}

/** Throws CONFLICT unless the decision may be approved / built for `proposalId`. */
export function assertDecisionApprovable(decision: StoredDecisionLike, proposalId: string): void {
  const check = checkDecisionForApproval(decision, proposalId);
  if (!check.ok) throw new DomainError("CONFLICT", check.reason);
}

/**
 * Old writers must not run or re-evaluate newer runs: if the session was started for, or any decision of it (current
 * or superseded) has, a higher gate version than this release supports, no phase may run and no verdict may be
 * (re)computed for it – no silent downgrade.
 * Decisions without a version (outdated writer) do not block; they are simply never approvable.
 */
export function assertCanEvaluateSession(gateVersions: ReadonlyArray<number | null | undefined>): void {
  const newer = gateVersions.filter((v): v is number => typeof v === "number" && v > MAX_SUPPORTED_GATE_VERSION);
  if (newer.length > 0)
    throw new DomainError(
      "CONFLICT",
      `This council uses gate version ${Math.max(...newer)}; this version supports up to ${MAX_SUPPORTED_GATE_VERSION} and must not run or re-evaluate it. Deploy the newer release again.`,
    );
}

/**
 * Gate versions of a session: the version it was started for (stage 1b, set before any verdict exists) and those of
 * every decision, superseded ones included. Callers have already resolved the session
 * through a tenant-checked path (loadSession) or run as the worker for a claimed job.
 */
export async function sessionGateVersions(db: Database, sessionId: string) {
  const [session] = await db
    .select({ gateVersion: schema.councilSession.gateVersion })
    .from(schema.councilSession)
    .where(eq(schema.councilSession.id, sessionId));
  const rows = await db
    .select({ gateVersion: schema.finalDecision.gateVersion })
    .from(schema.finalDecision)
    .where(eq(schema.finalDecision.sessionId, sessionId));
  return [...(session ? [session.gateVersion] : []), ...rows.map((r) => r.gateVersion)];
}

export interface DecisionStatus {
  gateVersion: number | null;
  /** This release knows the matrix format (supported gate version); otherwise clients show only the neutral reason. */
  readable: boolean;
  /** False when the version or the outcome is not one this release can approve; `reason` says why, neutrally. */
  approvable: boolean;
  reason: string | null;
  /** "Approve recommendation" is possible (format, outcome and the recommended entry pass). Security gates are separate. */
  canApproveRecommendation: boolean;
  /** Proposals that pass the format and feasibility check for select_alternative. Security gates are separate. */
  approvableProposalIds: string[];
}

/** What the session view returns to every client (web, VS Code); the same rules as the server-side checks. */
export function decisionStatusOf(decision: StoredDecisionLike, proposalIds: ReadonlyArray<string>): DecisionStatus {
  const display = decisionDisplayCheck(decision);
  const approvableProposalIds = display.ok ? proposalIds.filter((id) => checkDecisionForApproval(decision, id).ok) : [];
  return {
    gateVersion: decision.gateVersion ?? null,
    readable: isSupportedGateVersion(decision.gateVersion) && (decision.gateVersion !== 2 || hasRequirementGate(decision.matrix)),
    approvable: display.ok,
    reason: display.ok ? null : display.reason,
    canApproveRecommendation:
      display.ok &&
      decision.outcome === "recommended" &&
      decision.recommendedProposalId !== null &&
      checkDecisionForApproval(decision, decision.recommendedProposalId).ok,
    approvableProposalIds,
  };
}
