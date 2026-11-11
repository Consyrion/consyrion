/**
 * Contract between the public application and the CONSYRIUM engine (#188).
 *
 * The engine holds the business-critical logic (verdict, requirement gate, content checks, prompts, strength
 * catalog). Its implementation lives in packages/engine/src; this file only describes the interface, so keep it free
 * of logic.
 */

/** Raised whenever the contract changes; an engine built for another contract version is refused. */
export const ENGINE_CONTRACT_VERSION = 6;

/** production: the real engine in packages/engine/src. test/stub: stand-ins kept for engines built elsewhere. */
export type EngineKind = "production" | "test" | "stub";

export interface EngineInfo {
  kind: EngineKind;
  name: string;
  contract: number;
}

/** One evaluator's statement about one requirement of one proposal (#181, S1). */
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

/**
 * A stored raw requirement check (append-only). `valid` is decided by the application before the engine sees it:
 * bound to a proposal, revision and requirement of the frozen round and given by an expected evaluator of that
 * proposal. Invalid checks are passed along for display only; they never count.
 */
export interface RawRequirementCheck {
  evaluatorParticipantId: string;
  proposalId: string;
  /** Revision the check was given for; counts only if it is the frozen revision of the round. */
  revisionId: string;
  requirementId: string;
  status: CheckStatus;
  /** The evaluator's explicit statement that every part of the requirement is met; null when not given. */
  allPartsMet: boolean | null;
  evidence: string;
  valid: boolean;
  /**
   * Contract 3: the evaluator's estimate for a measured requirement (GateRound.measures), in the measure's unit;
   * null when not given or not a measured requirement.
   */
  estimate: { low: number; high: number } | null;
}

/** Contract 3: a measurable limit of a confirmed requirement (time, monthly cost, availability). */
export interface GateMeasure {
  /** max: estimates must stay at or below `value`; min: at or above it. */
  direction: "max" | "min";
  value: number;
  unit: string;
  /** #226: the limit excludes `value` ("below 150", "above 99.9 %"). Absent = inclusive, as on every older list. */
  strict?: boolean;
}

/** The frozen evaluation round (#181, S1): fixed before the first Final Verdict call, never changed afterwards. */
export interface GateRound {
  requirementIds: string[];
  /**
   * Contract 3: requirement id → measurable limit. For these requirements an evaluator's statement comes from its
   * estimate, not from its PASS/FAIL. Absent for rounds frozen before contract 3 (unchanged behaviour).
   */
  measures?: Record<string, GateMeasure>;
  /**
   * Requirements only the implementation can prove (tests/CI, night test R4). Their PASS means "a concrete verification
   * plan is named"; the result carries `buildVerification` so nobody shows it as verified. Absent: unchanged behaviour.
   */
  buildChecks?: string[];
  /**
   * #249 part 2 (contract 5, gate version 3): requirements only a measurement of the running implementation can prove
   * ("rhythmically stable interplay"). Their PASS means "a concrete measurement plan is named" – never that the
   * requirement is met. A proposal whose every other check passed is an architecture candidate, never qualified.
   * Absent: unchanged behaviour (gate version 2).
   */
  measurementChecks?: string[];
  /**
   * Contract 6 (owner decision 08.11.26): the same model may take part through several keys, but counts as ONE
   * independent evaluator. participant id → independence group (e.g. normalised provider/model family). Participants
   * of the author's group never evaluate that proposal; minimum breadth, majorities and per-requirement statements count
   * groups. Absent, or a participant missing from it: every participant is its own group (unchanged behaviour).
   */
  participantGroups?: Record<string, string>;
  proposals: Array<{
    proposalId: string;
    /** The frozen revision evaluated in this round. */
    revisionId: string;
    authorParticipantId: string;
    /** E(p): participants active at the start of the Final Verdict, without the author. */
    expectedEvaluatorIds: string[];
    /** The proposal as written (latest revision of the round). */
    content: unknown;
  }>;
}

export interface GateInput {
  round: GateRound;
  checks: RawRequirementCheck[];
  /** Evaluators of the round whose evaluation (scores and vote) was stored. */
  deliveredEvaluatorIds: string[];
}

export type RequirementStatus = "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN";
export type Feasibility = "qualified" | "needs_verification" | "fail" | "incomplete";

export interface GateRequirementResult {
  requirementId: string;
  status: RequirementStatus;
  /** Evaluators per counted statement; `open` lists expected evaluators without a counting statement. */
  pass: string[];
  fail: string[];
  unknown: string[];
  open: string[];
  /** Evaluators that stated both PASS and FAIL for this requirement (counted as FAIL). */
  conflicts: string[];
  /** Build check (night test R4): PASS = verification plan named, the requirement itself is verified after implementation. */
  buildVerification?: boolean;
  /**
   * Contract 5: measurement check (#249 part 2). PASS = measurement plan named; the requirement itself stays open until
   * the running implementation is measured. Never shown as met.
   */
  measurementPending?: boolean;
  /**
   * Contract 3, measured requirements only: the counted estimates – lowest low, highest high, median of the
   * evaluators' midpoints – with the limit they were compared with; null otherwise or without any valid estimate.
   */
  estimate?: {
    low: number;
    high: number;
    median: number;
    evaluators: number;
    limit: GateMeasure;
    /** Counted UNKNOWN evaluators whose range crosses the limit, and those without a usable estimate. */
    straddling?: number;
    withoutEstimate?: number;
  } | null;
}

export interface GateProposalResult {
  proposalId: string;
  feasibility: Feasibility;
  requirements: GateRequirementResult[];
  /** Why the proposal is not qualified, one neutral sentence each; empty when qualified. */
  causes: string[];
  /**
   * The single evaluator whose statements alone keep this proposal from qualified (every FAIL/UNKNOWN comes from it,
   * nothing is open); null otherwise. Lets the verdict detect an author blocking its competitors (conflict of interest).
   */
  soleBlocker: string | null;
  /**
   * #249 (contract 4): every check passed, but fewer independent evaluators than a recommendation needs took part (for
   * example after a model dropped out). Then the proposal is a provisional favourite: never qualified, never approvable.
   */
  limitedReview?: boolean;
  /**
   * #249 part 2 (contract 5): every check passed with enough independent evaluators, but at least one requirement is a
   * measurement check – only its plan was confirmed. An architecture candidate with the performance proof open: never
   * qualified, never a recommendation, never regularly approvable.
   */
  architectureCandidate?: boolean;
}

export interface GateResult {
  proposals: GateProposalResult[];
  /**
   * False when the proposals were not compared on equal terms (e.g. an expected evaluator failed): then no automatic
   * recommendation, even among qualified proposals.
   */
  comparisonComplete: boolean;
  comparisonNote: string | null;
  /** Neutral summary when no proposal is qualified; never claims that the requirements cannot be met together. */
  summary: string | null;
}

export interface Engine {
  info: EngineInfo;
  /** The S1 requirement gate (gate version 2): the only authority on feasibility of a version-2 verdict. */
  evaluateGate(input: GateInput): GateResult;
  /** Instruction for evaluators on how to check every confirmed requirement (part of the Final Verdict prompt). */
  requirementCheckInstruction: string;
}

/** Error code returned to clients when no usable engine is installed. */
export const ENGINE_NOT_INSTALLED = "ENGINE_NOT_INSTALLED";

/** Why councils cannot run with this engine, or null when they can. */
export function engineProblem(engine: Pick<Engine, "info">): string | null {
  if (engine.info.kind === "stub") return "This installation has no CONSYRIUM engine, so councils cannot run.";
  if (engine.info.contract !== ENGINE_CONTRACT_VERSION)
    return `The installed CONSYRIUM engine implements contract ${engine.info.contract}, this release needs contract ${ENGINE_CONTRACT_VERSION}.`;
  return null;
}
