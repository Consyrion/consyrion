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
 * 2 = the S1 requirement gate (#181). Feasibility comes only from the private engine's gate result stored in the
 *     matrix; a release that only knows 1 never approves, builds or re-evaluates it.
 * 3 = version 2 plus measurement checks (#249 part 2, engine contract 5): a requirement only measuring the running
 *     implementation can prove is checked as a measurement plan, and a proposal whose every check passed is an
 *     architecture candidate – never qualified, never regularly approvable. New councils are started for it; councils
 *     started for 2 finish with 2 and keep their result.
 *
 * Everything a reader does not know – a higher version, a missing version, an outcome it has no rule for – is
 * "not approvable". Unknown never falls back to the permissive legacy path.
 */
/** Gate version new councils are started for. */
export const GATE_VERSION = 3;
/** Highest gate version this release can evaluate, approve and build. */
export const MAX_SUPPORTED_GATE_VERSION = 3;

/** Outcomes each gate version produces and that a reader may treat as possibly approvable. */
const APPROVABLE_OUTCOMES: Readonly<Record<number, ReadonlySet<string>>> = {
  1: new Set(["recommended", "no_qualifying_solution", "tie", "insufficient_evidence"]),
  2: new Set(["recommended", "no_qualifying_solution", "tie", "insufficient_evidence"]),
  3: new Set(["recommended", "no_qualifying_solution", "tie", "insufficient_evidence"]),
};

/** Versions whose feasibility rests on the engine's requirement gate result (S1, #181). */
export const isRequirementGateVersion = (gateVersion: number | null | undefined): boolean => typeof gateVersion === "number" && gateVersion >= 2;

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

/**
 * #249 part 2: every check passed, but a requirement can only be confirmed by measuring the running implementation – an
 * architecture candidate, never regularly approvable. A marked prototype/measurement build is a separate path (not
 * part of this release).
 */
export const ARCHITECTURE_CANDIDATE_MESSAGE =
  "Architecture candidate – performance proof open: a requirement can only be confirmed by measuring the running implementation. The council confirmed the measurement plan, not the requirement, so this proposal cannot be approved as a finished solution.";

/** #511: the open measurement requirements of every architecture candidate in a stored gate result, in order. */
function architectureCandidateRequirements(matrix: unknown): string[] {
  const proposals = (matrix as { requirementGate?: { proposals?: GateEntry[] } } | null)?.requirementGate?.proposals;
  if (!Array.isArray(proposals)) return [];
  const ids = proposals
    .filter((g) => g?.architectureCandidate === true)
    .flatMap((g) => (g.requirements ?? []).filter((r) => r?.measurementPending === true).map((r) => String(r.requirementId)));
  return [...new Set(ids)];
}

/** #511: the reason shown for a verdict whose best proposal is an architecture candidate. */
export function architectureCandidateText(requirementIds: string[]): string {
  return `Architecture candidate – performance proof open: ${requirementIds.join(", ")} can only be confirmed by measuring the running implementation. The council confirmed the measurement plan, not the requirement, so no proposal can be approved as a finished solution yet. Mark it as favourite, approve a prototype / measurement build or record the measured result.`;
}

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
  if (isRequirementGateVersion(decision.gateVersion) && !hasRequirementGate(decision.matrix))
    return { ok: false, reason: "The stored verdict has no requirement gate result. It cannot be approved or built." };
  if (!APPROVABLE_OUTCOMES[decision.gateVersion]!.has(decision.outcome)) {
    // #511: an architecture candidate is named with the requirements whose measurement is open, not as a generic gap.
    const open = architectureCandidateRequirements(decision.matrix);
    if (decision.outcome === "needs_verification" && open.length) return { ok: false, reason: architectureCandidateText(open) };
    return { ok: false, reason: unapprovableOutcomeText(decision.outcome) };
  }
  return { ok: true };
}

function hasRequirementGate(matrix: unknown): boolean {
  const gate = (matrix as { requirementGate?: { proposals?: unknown } } | null)?.requirementGate;
  return Array.isArray(gate?.proposals);
}

type MatrixEntry = { proposalId?: unknown; implementable?: unknown; feasibility?: unknown; securityBelowMinimum?: unknown };
type GateEntry = {
  proposalId?: unknown;
  feasibility?: unknown;
  limitedReview?: unknown;
  architectureCandidate?: unknown;
  requirements?: Array<{ requirementId?: unknown; status?: unknown; measurementPending?: unknown }>;
};
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
    // #249 part 2: an open measurement is never qualified, whatever the stored entry claims.
    if (
      g.feasibility === "qualified" &&
      (g.architectureCandidate === true || (Array.isArray(g.requirements) && g.requirements.some((r) => r?.measurementPending === true)))
    )
      return "a proposal is marked both qualified and with an open measurement";
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
  if (isRequirementGateVersion(decision.gateVersion)) {
    // S1: only an entry the engine's gate marked qualified – missing or contradictory fields are refused, never assumed.
    const v2 = matrix as unknown as V2Matrix;
    const problem = v2MatrixProblem(v2);
    if (problem) return { ok: false, reason: `The stored verdict is inconsistent: ${problem}. It cannot be approved or built.` };
    const gateEntry = v2.requirementGate!.proposals!.find((g) => g.proposalId === proposalId)!;
    const allPass = (gateEntry.requirements ?? []).every((r) => r?.status === "PASS");
    if (gateEntry.limitedReview === true) return { ok: false, reason: LIMITED_REVIEW_MESSAGE };
    if (gateEntry.architectureCandidate === true) return { ok: false, reason: ARCHITECTURE_CANDIDATE_MESSAGE };
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
 * #249 part 2 / #478 (owner decision 08.11.26): a proposal of a needs-verification verdict that may be marked as
 * favourite or get a marked prototype/measurement build – an architecture candidate, or a proposal the gate qualified
 * while the verdict as a whole needs verification. Never a regular approval: approve and select_alternative keep their
 * own rules. Gate version 3 only; a security minimum and the matrix consistency still apply.
 */
export function checkPrototypeEligibility(decision: StoredDecisionLike, proposalId: string): DecisionCheck {
  if (decision.gateVersion !== 3) return { ok: false, reason: "Favourites and prototype builds exist only for councils of gate version 3." };
  if (decision.outcome !== "needs_verification")
    return { ok: false, reason: "Only a verdict that needs verification can have a favourite or a prototype build." };
  const matrix = decision.matrix as V2Matrix | null;
  if (!matrix || !Array.isArray(matrix.proposals)) return { ok: false, reason: "The stored verdict has no evaluation matrix." };
  const problem = v2MatrixProblem(matrix);
  if (problem) return { ok: false, reason: `The stored verdict is inconsistent: ${problem}.` };
  const entry = matrix.requirementGate!.proposals!.find((g) => g.proposalId === proposalId);
  const row = matrix.proposals.find((p) => p?.proposalId === proposalId);
  if (!entry || !row) return { ok: false, reason: "The proposal is not part of the stored verdict." };
  if (entry.limitedReview === true) return { ok: false, reason: LIMITED_REVIEW_MESSAGE };
  const allPass = (entry.requirements ?? []).every((r) => r?.status === "PASS");
  const qualified = entry.feasibility === "qualified" && row.implementable === true && allPass;
  const candidate = entry.architectureCandidate === true && entry.feasibility === "needs_verification" && allPass;
  if (!qualified && !candidate)
    return {
      ok: false,
      reason: "Only an architecture candidate or a proposal that meets every confirmed requirement can be a favourite or get a prototype build.",
    };
  if (row.securityBelowMinimum !== false)
    return { ok: false, reason: "This proposal is below the security minimum of the policy (or the verdict does not say)." };
  return { ok: true };
}

/** Requirements of a proposal whose measurement is still open in the stored gate result (#249 part 2). */
export function pendingMeasurements(decision: StoredDecisionLike, proposalId: string): string[] {
  const entry = (decision.matrix as V2Matrix | null)?.requirementGate?.proposals?.find((g) => g.proposalId === proposalId);
  return (entry?.requirements ?? []).filter((r) => r?.measurementPending === true).map((r) => String(r.requirementId));
}

/**
 * #249 gate 2: the regular approval of an architecture candidate after its open measurements were recorded. Every
 * requirement still marked measurementPending must be recorded as met; a single recorded "not met" refuses for good. All
 * other rules stay: a prototype-eligible candidate (consistent matrix, every other check PASS, enough evaluators,
 * security minimum) and a comparison on equal terms. The requirement stays hard – only the measured value fulfils it.
 */
export function checkApprovalAfterMeasurement(decision: StoredDecisionLike, proposalId: string, latestMet: ReadonlyMap<string, boolean>): DecisionCheck {
  const eligible = checkPrototypeEligibility(decision, proposalId);
  if (!eligible.ok) return eligible;
  const matrix = decision.matrix as V2Matrix;
  const entry = matrix.requirementGate!.proposals!.find((g) => g.proposalId === proposalId)!;
  if (entry.architectureCandidate !== true) return { ok: false, reason: "Only an architecture candidate is approved after measurement." };
  if (matrix.requirementGate!.comparisonComplete !== true)
    return { ok: false, reason: "The proposals were not compared on equal terms; this verdict cannot be approved after measurement." };
  const pending = pendingMeasurements(decision, proposalId);
  const failed = pending.filter((id) => latestMet.get(id) === false);
  if (failed.length) return { ok: false, reason: `The measurement did not meet ${failed.join(", ")}. This proposal cannot be approved.` };
  const open = pending.filter((id) => latestMet.get(id) !== true);
  if (open.length) return { ok: false, reason: `Measurement still open for ${open.join(", ")}.` };
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
  if (!isRequirementGateVersion(decision.gateVersion)) return;
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
  /** #249 part 2 / #478: proposals that may be marked as favourite or get a marked prototype build (never an approval). */
  prototypeProposalIds: string[];
  /** #249 gate 2: architecture candidates whose open measurements were all recorded as met – approvable after measurement. */
  measurementApprovableProposalIds: string[];
}

/** What the session view returns to every client (web, VS Code); the same rules as the server-side checks. */
export function decisionStatusOf(
  decision: StoredDecisionLike,
  proposalIds: ReadonlyArray<string>,
  measurements: ReadonlyMap<string, ReadonlyMap<string, boolean>> = new Map(),
): DecisionStatus {
  const display = decisionDisplayCheck(decision);
  const approvableProposalIds = display.ok ? proposalIds.filter((id) => checkDecisionForApproval(decision, id).ok) : [];
  return {
    gateVersion: decision.gateVersion ?? null,
    readable: isSupportedGateVersion(decision.gateVersion) && (!isRequirementGateVersion(decision.gateVersion) || hasRequirementGate(decision.matrix)),
    approvable: display.ok,
    reason: display.ok ? null : display.reason,
    canApproveRecommendation:
      display.ok &&
      decision.outcome === "recommended" &&
      decision.recommendedProposalId !== null &&
      checkDecisionForApproval(decision, decision.recommendedProposalId).ok,
    approvableProposalIds,
    prototypeProposalIds: proposalIds.filter((id) => checkPrototypeEligibility(decision, id).ok),
    measurementApprovableProposalIds: proposalIds.filter((id) => checkApprovalAfterMeasurement(decision, id, measurements.get(id) ?? new Map()).ok),
  };
}
