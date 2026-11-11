import { COUNCIL_ROLES, DEFAULT_EVALUATION_WEIGHTS, validateWeights, type CouncilRole, type DecisionMode, type EvaluationWeights } from "./phases";

/** Bump when the meaning of a policy field changes; stored with every session. */
export const POLICY_VERSION = 1;

export type Severity = "low" | "medium" | "high" | "critical";

/**
 * Orchestration rules of a council run. Modes differ in these values, not only in prompt wording.
 * A snapshot is stored with the session, so later policy changes never alter running sessions.
 */
export interface WorkflowPolicy {
  mode: DecisionMode;
  /** Active 12 Minds Council perspectives. */
  roles: CouncilRole[];
  /** Number of critique rounds in the 12 Minds Council. */
  debateRounds: number;
  /** Whether criticised authors answer each critique (rebuttal threads). */
  rebuttals: boolean;
  /** Open Council: participants ask each proposal targeted questions which the authors answer. */
  openCouncilQuestions: boolean;
  /** Lowest critique severity that becomes a tracked Minority Review objection. */
  objectionSeverityThreshold: Severity;
  /** A second, different model verifies each objection verdict in Minority Review. */
  independentVerification: boolean;
  /** Consensus Round revision passes. */
  consensusRounds: number;
  /** Consensus Round may produce a hybrid proposal (always reviewed, never auto-approved). */
  allowHybrid: boolean;
  weights: EvaluationWeights;
  /** Minimum security score (0–10, mean of independent evaluators) for a proposal to be eligible. */
  minSecurityScore: number;
  /** Minimum weighted total (0–10) for a recommendation; below it the outcome is "no qualifying solution". */
  minTotalScore: number;
  /** Totals closer than this are treated as a tie and handed to the human. */
  tieMargin: number;
  /** Maximum extra debate rounds a human may request with "request more debate". */
  maxExtraRounds: number;
  /** Hard server-side token budget for the whole run. */
  tokenBudget: number;
  /** Output limit per model call. */
  maxOutputTokens: number;
  /** Per-call timeout. */
  callTimeoutMs: number;
  /** Optional session rules written by the user (e.g. "focus on cost"); appended to every system prompt. */
  customRules: string;
  /**
   * What the user wants from this council (#597). "idea_check": an early idea without contracts or measurements – the
   * verdict screen reads the result as a recommendation with open points to clarify. "approval" (also when absent):
   * a decision to approve and build. It changes only how the result is presented: phases, prompts, the requirement
   * gate, approval and build are the same for both.
   */
  purpose?: CouncilPurpose;
}

export const COUNCIL_PURPOSES = ["idea_check", "approval"] as const;
export type CouncilPurpose = (typeof COUNCIL_PURPOSES)[number];

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function severityAtLeast(value: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[value] >= SEVERITY_ORDER[threshold];
}

const BASE = {
  minSecurityScore: 5,
  minTotalScore: 5,
  tieMargin: 0.25,
  maxExtraRounds: 2,
  maxOutputTokens: 4_000,
  callTimeoutMs: 180_000,
  customRules: "",
} as const;

export const MODE_POLICIES: Record<DecisionMode, Omit<WorkflowPolicy, "tokenBudget">> = {
  independent_expert: {
    ...BASE,
    mode: "independent_expert",
    roles: ["software_architect", "security_expert", "cost_analyst", "independent_critical_thinker"],
    debateRounds: 1,
    rebuttals: false,
    openCouncilQuestions: true,
    objectionSeverityThreshold: "high",
    independentVerification: false,
    consensusRounds: 1,
    allowHybrid: false,
    weights: DEFAULT_EVALUATION_WEIGHTS,
  },
  adversarial_review: {
    ...BASE,
    mode: "adversarial_review",
    roles: [...COUNCIL_ROLES],
    debateRounds: 2,
    rebuttals: true,
    openCouncilQuestions: true,
    objectionSeverityThreshold: "medium",
    independentVerification: true,
    consensusRounds: 1,
    allowHybrid: false,
    weights: { technicalQuality: 30, security: 35, maintainability: 15, operatingCost: 10, implementationSpeed: 10 },
    minSecurityScore: 6,
  },
  consensus: {
    ...BASE,
    mode: "consensus",
    roles: ["software_architect", "security_expert", "backend_engineer", "cost_analyst", "product_strategist", "independent_critical_thinker"],
    debateRounds: 1,
    rebuttals: true,
    openCouncilQuestions: false,
    objectionSeverityThreshold: "high",
    independentVerification: false,
    consensusRounds: 2,
    allowHybrid: true,
    weights: DEFAULT_EVALUATION_WEIGHTS,
  },
};

export const DEFAULT_TOKEN_BUDGET = 400_000;
export const MAX_TOKEN_BUDGET = 5_000_000;
export const MIN_TOKEN_BUDGET = 10_000;
/** Absolute limits on council size; plans may allow fewer (entitlement maxParticipantsPerSession). */
export const MIN_PARTICIPANTS = 2;
/** Council sessions that may run at the same time in one workspace (#7) – protects budgets and providers. */
export const MAX_CONCURRENT_SESSIONS = 3;
export const MAX_PARTICIPANTS = 6;

/** Shared by the API and the configuration UI so both reject the same budgets with the same message. */
export function tokenBudgetError(budget: number): string | null {
  return Number.isInteger(budget) && budget >= MIN_TOKEN_BUDGET && budget <= MAX_TOKEN_BUDGET
    ? null
    : `Token budget must be between ${MIN_TOKEN_BUDGET.toLocaleString("en-US")} and ${MAX_TOKEN_BUDGET.toLocaleString("en-US")}`;
}

export interface PolicyOverrides {
  roles?: CouncilRole[];
  debateRounds?: number;
  consensusRounds?: number;
  allowHybrid?: boolean;
  weights?: EvaluationWeights;
  tokenBudget?: number;
  maxOutputTokens?: number;
  customRules?: string;
  purpose?: CouncilPurpose;
}

/**
 * Builds the policy for a run. Only bounded, explicitly allowed fields can be overridden by the
 * client; gates such as Minority Review and human approval cannot be switched off.
 */
export function buildPolicy(mode: DecisionMode, overrides: PolicyOverrides = {}): { policy: WorkflowPolicy; errors: string[] } {
  const base = MODE_POLICIES[mode];
  const policy: WorkflowPolicy = {
    ...base,
    roles: overrides.roles ?? base.roles,
    debateRounds: overrides.debateRounds ?? base.debateRounds,
    consensusRounds: overrides.consensusRounds ?? base.consensusRounds,
    allowHybrid: overrides.allowHybrid ?? base.allowHybrid,
    weights: overrides.weights ?? base.weights,
    tokenBudget: overrides.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    maxOutputTokens: overrides.maxOutputTokens ?? base.maxOutputTokens,
    customRules: (overrides.customRules ?? "").trim(),
    // Only stored when chosen: councils started without it keep the policy shape they always had.
    ...(overrides.purpose ? { purpose: overrides.purpose } : {}),
  };
  const errors: string[] = [];
  if (overrides.purpose && !(COUNCIL_PURPOSES as readonly string[]).includes(overrides.purpose)) errors.push("Unknown council purpose");
  if (policy.roles.length < 1 || policy.roles.length > 12) errors.push("Between 1 and 12 roles are required");
  if (new Set(policy.roles).size !== policy.roles.length) errors.push("Roles must be unique");
  if (policy.roles.some((role) => !(COUNCIL_ROLES as readonly string[]).includes(role))) errors.push("Unknown role");
  if (!Number.isInteger(policy.debateRounds) || policy.debateRounds < 1 || policy.debateRounds > 3) errors.push("Debate rounds must be 1–3");
  if (!Number.isInteger(policy.consensusRounds) || policy.consensusRounds < 1 || policy.consensusRounds > 3) errors.push("Consensus rounds must be 1–3");
  const budgetError = tokenBudgetError(policy.tokenBudget);
  if (budgetError) {
    errors.push(budgetError);
  }
  if (!Number.isInteger(policy.maxOutputTokens) || policy.maxOutputTokens < 500 || policy.maxOutputTokens > 32_000)
    errors.push("Max output tokens must be 500–32,000");
  if (policy.customRules.length > 2_000) errors.push("Session rules must be at most 2,000 characters");
  errors.push(...validateWeights(policy.weights));
  return { policy, errors };
}

/** Number of model calls per phase for a given number of participants. Used for the cost preview. */
export function estimateCalls(policy: WorkflowPolicy, participants: number, requirements = 0) {
  const n = participants;
  const roles = policy.roles.length;
  const independentThinking = n;
  const openCouncil = policy.openCouncilQuestions ? n * 2 : n;
  // Each role reviews all proposals per round; with rebuttals every author answers once per round.
  const twelveMinds = policy.debateRounds * (roles + (policy.rebuttals ? n : 0)) + roles;
  const minorityReview = n + (policy.independentVerification ? 2 : 1);
  const consensusRound = policy.consensusRounds * n + (policy.allowHybrid ? 2 : 0);
  // #246: an evaluation that does not fit into one answer is split into several calls per evaluator.
  const finalVerdict = n * finalVerdictCallItems(Math.max(0, n - 1), requirements).length;
  const total = independentThinking + openCouncil + twelveMinds + minorityReview + consensusRound + finalVerdict;
  return { independentThinking, openCouncil, twelveMinds, minorityReview, consensusRound, finalVerdict, total };
}

/**
 * Minimum output limit per provider. Measured in real runs: DeepSeek's structured answers regularly
 * exceeded 4,000 output tokens and were cut off, so its calls start higher (an API that caps lower answers with
 * its limit and the adapter retries with 8,192). OpenAI's reasoning models (gpt-5-mini) spend part of the output on
 * reasoning and were cut off at 4,000 in 7 of 94 calls (call-report, 27.–30.10.26, #243). GLM, Qwen and xAI Grok use the same JSON-mode path and start at the same limit. Kimi K2.6 and Gemini spend part
 * of the output on reasoning and were cut off at 8,000 (#147). Claude Haiku 5.5 was cut off at 4,000 in role
 * reviews and objection answers in almost every phase (#172), so Anthropic starts at 8,000 everywhere.
 */
export const PROVIDER_MIN_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
  anthropic: 8_000,
  openai: 8_000,
  deepseek: 8_000,
  glm: 8_000,
  kimi: 16_000,
  google: 16_000,
  qwen: 8_000,
  xai: 8_000,
};

/**
 * Answers with large structures: a full proposal, a revision, a hybrid or the scorecard of every proposal. Claude
 * Haiku 5.5 was cut off at 4,000 tokens in these in almost every run and paid each step twice (#147), so Anthropic
 * calls for them start at 8,000. With repository context (#237) proposals grow: DeepSeek V4.1 Flash was cut off at
 * 8,000 in 10 of its Independent Thinking calls and gpt-5-mini at 4,000 in 5 (call-report, 27.–30.10.26, #243), so
 * both start these answers at 16,000. Only the reservation grows – the budget is charged with the tokens actually used.
 */
export const LARGE_ANSWER_SCHEMAS: ReadonlySet<string> = new Set(["proposal", "revision", "hybrid", "evaluation", "evaluation_checks"]);
export const PROVIDER_MIN_LARGE_OUTPUT_TOKENS: Readonly<Record<string, number>> = { anthropic: 8_000, openai: 16_000, deepseek: 16_000 };

/**
 * Output per item for answers whose size grows with what they cover (#172): a role review and a scorecard per
 * proposal, an answer or verdict per question, critique or objection. Six proposals in one role review cut Claude
 * Haiku 5.5 off even at 8,000 tokens; 27 objections in one answer did the same in the Minority Review.
 */
export const OUTPUT_TOKENS_PER_ITEM: Readonly<Record<string, number>> = {
  role_review: 2_000,
  evaluation: 1_500,
  evaluation_checks: 1_500,
  open_council: 800,
  answers: 500,
  rebuttals: 500,
  objection_responses: 500,
  adjudication: 400,
};

/** Highest output limit any council call asks for (= the policy maximum). */
export const MAX_CALL_OUTPUT_TOKENS = 32_000;

/**
 * Output one Final Verdict check item really needs (#228): one foreign proposal × one confirmed requirement, scores
 * included. Highest measured value on 30.10.26 (DeepSeek V4.1 Flash, 24 calls): 1,230. Used only for the size check
 * before the start; the reservation per call stays `OUTPUT_TOKENS_PER_ITEM.evaluation`.
 */
export const EVALUATION_TOKENS_PER_ITEM_MEASURED = 1_250;

/**
 * #246 (split evaluator): share of one call a group of a split Final Verdict may fill. Below the 75 % "tight" mark, so
 * no group of a split evaluation sits at the edge of the limit like the single call it replaces.
 */
export const SPLIT_GROUP_FILL = 0.75;

/** Requirements one Final Verdict call of an evaluator checks for `foreign` proposals (#246). All when they fit (#228). */
export function finalVerdictGroupSize(foreign: number, requirements: number): number {
  const all = Math.max(1, requirements);
  if (foreign <= 0 || foreign * all * EVALUATION_TOKENS_PER_ITEM_MEASURED <= MAX_CALL_OUTPUT_TOKENS) return all;
  return Math.max(1, Math.floor((MAX_CALL_OUTPUT_TOKENS * SPLIT_GROUP_FILL) / (EVALUATION_TOKENS_PER_ITEM_MEASURED * foreign)));
}

/**
 * The requirement ids an evaluator checks per call (#246): one group – the unchanged single call – whenever the whole
 * evaluation fits into one answer (#228); otherwise balanced groups in list order, each well below the call limit. The
 * first call also writes the scores and the ranking, the others only the requirement checks. Pure and deterministic:
 * the same list and number of proposals always give the same groups (also on resume).
 */
export function splitRequirementIds(requirementIds: readonly string[], foreign: number): string[][] {
  if (requirementIds.length === 0) return [[]];
  const size = finalVerdictGroupSize(foreign, requirementIds.length);
  const calls = Math.ceil(requirementIds.length / size);
  const per = Math.ceil(requirementIds.length / calls);
  const groups: string[][] = [];
  for (let i = 0; i < requirementIds.length; i += per) groups.push(requirementIds.slice(i, i + per));
  return groups;
}

/** Items (foreign proposals × requirements) of each Final Verdict call of one evaluator, first call first (#246). */
export function finalVerdictCallItems(foreign: number, requirements: number): number[] {
  const ids = Array.from({ length: Math.max(1, requirements) }, (_, i) => `R${i + 1}`);
  return splitRequirementIds(ids, foreign).map((group) => Math.max(1, foreign) * group.length);
}

/**
 * Does each evaluator's Final Verdict fit (#228, ADR 0228; #246)? Every evaluator checks the proposals of all other
 * models against every confirmed requirement. Up to the call limit (`MAX_CALL_OUTPUT_TOKENS`) that is one answer –
 * above three quarters with a warning. Beyond it the checks are split into several calls per evaluator (#246); only a
 * council in which not even one requirement per call fits is refused before any model is paid.
 */
export function finalVerdictFit(participants: number, requirements: number) {
  const foreign = Math.max(0, participants - 1);
  const items = foreign * Math.max(1, requirements);
  const needed = items * EVALUATION_TOKENS_PER_ITEM_MEASURED;
  const maxRequirements = foreign ? Math.floor(MAX_CALL_OUTPUT_TOKENS / (EVALUATION_TOKENS_PER_ITEM_MEASURED * foreign)) : Infinity;
  const callsPerEvaluator = finalVerdictCallItems(foreign, requirements).length;
  const split = callsPerEvaluator > 1;
  return {
    items,
    needed,
    limit: MAX_CALL_OUTPUT_TOKENS,
    fits: foreign * EVALUATION_TOKENS_PER_ITEM_MEASURED <= MAX_CALL_OUTPUT_TOKENS,
    tight: !split && needed > MAX_CALL_OUTPUT_TOKENS * 0.75,
    maxRequirements,
    split,
    callsPerEvaluator,
    requirementsPerCall: finalVerdictGroupSize(foreign, requirements),
  };
}

/** The refusal, split and warning texts of `finalVerdictFit`, the same on the start screen and in the API error. */
export function finalVerdictFitMessage(fit: ReturnType<typeof finalVerdictFit>, participants: number, requirements: number): string | null {
  if (!fit.fits)
    return `${participants} models are too many for one Final Verdict evaluation: even a single requirement does not fit into one call (about ${fit.needed.toLocaleString("en-US")} of at most ${fit.limit.toLocaleString("en-US")} output tokens). Use fewer models.`;
  if (fit.split)
    return `${participants} models × ${requirements} requirements do not fit into one Final Verdict evaluation, so each evaluator checks them in ${fit.callsPerEvaluator} calls of at most ${fit.requirementsPerCall} requirements. The brief and the proposals are sent once per call: the estimate, the minimum budget and the hard budget include these calls. Fewer requirements or models need fewer calls.`;
  if (fit.tight)
    return `${participants} models × ${requirements} requirements fill most of one Final Verdict evaluation (about ${fit.needed.toLocaleString("en-US")} of ${fit.limit.toLocaleString("en-US")} output tokens per evaluator). A verbose model may be cut off; fewer requirements or models make it safer.`;
  return null;
}

/**
 * Minimum per-call timeout per provider. Measured in real runs: GLM 4.7 needed more than 180 s for a 12 Minds
 * role review; Kimi K2.6 timed out in 3 of 3 runs in Independent Thinking and Gemini Flash Latest needed > 180 s
 * for a proposal (#147), so their calls wait longer.
 */
export const PROVIDER_MIN_CALL_TIMEOUT_MS: Readonly<Record<string, number>> = { glm: 300_000, kimi: 300_000, google: 300_000 };

/** Timeout for one call: the session policy, raised to the provider minimum where one exists. */
export function callTimeoutFor(provider: string, policyTimeoutMs: number) {
  return Math.max(policyTimeoutMs, PROVIDER_MIN_CALL_TIMEOUT_MS[provider] ?? 0);
}

/**
 * Output limit for one call: the session policy, raised to the provider minimum (for large answers) where one exists
 * and to what `items` entries of this schema need (#172), at most `MAX_CALL_OUTPUT_TOKENS`.
 */
export function outputTokensFor(provider: string, policyMaxOutput: number, schemaName?: string, items = 0) {
  const large = schemaName !== undefined && LARGE_ANSWER_SCHEMAS.has(schemaName) ? (PROVIDER_MIN_LARGE_OUTPUT_TOKENS[provider] ?? 0) : 0;
  const perItem = schemaName !== undefined ? (OUTPUT_TOKENS_PER_ITEM[schemaName] ?? 0) * Math.max(0, items) : 0;
  const wanted = Math.max(PROVIDER_MIN_OUTPUT_TOKENS[provider] ?? 0, large, perItem);
  return Math.max(policyMaxOutput, Math.min(wanted, MAX_CALL_OUTPUT_TOKENS));
}

/**
 * Night test R4 (08.11.26): a council started with 120,000 tokens for three models and five requirements failed after
 * 7,800 tokens – "would leave too little for the Final Verdict" – although the user had accepted shortened phases.
 * Independent Thinking cannot be shortened and the Final Verdict keeps its reserve, so below this sum the council can
 * never finish. Same parts as the engine's reservations: every model writes one proposal, and every model evaluates
 * the others against every requirement (budget.ts `verdictReserve`).
 */
export function minimumCouncilBudget(policy: WorkflowPolicy, briefChars: number, providers: readonly string[], requirements: number): number {
  const n = Math.max(1, providers.length);
  const briefTokens = Math.ceil(briefChars / 4);
  const list = providers.length ? providers : [""];
  const thinking = list.reduce((sum, p) => sum + briefTokens + 1_500 + outputTokensFor(p, policy.maxOutputTokens, "proposal"), 0);
  const verdictInput = briefTokens + n * Math.min(policy.maxOutputTokens, 2_500) + 1_500;
  // #246: every call of a split evaluation sends the brief and the proposals again and reserves its own output.
  const calls = finalVerdictCallItems(Math.max(0, n - 1), requirements);
  const verdict = list.reduce(
    (sum, p) =>
      sum +
      calls.reduce(
        (s, items, index) => s + verdictInput + outputTokensFor(p, policy.maxOutputTokens, index === 0 ? "evaluation" : "evaluation_checks", items),
        0,
      ),
    0,
  );
  return Math.ceil(thinking + verdict);
}

/**
 * Rough upper bound used for the preview: every call may use its full output plus a growing context.
 * `providers` (one per participant) applies provider output minimums; without it the policy limit is used.
 */
export function estimateTokens(policy: WorkflowPolicy, participants: number, briefChars: number, providers?: readonly string[], requirements = 0) {
  const calls = estimateCalls(policy, participants, requirements).total;
  const briefTokens = Math.ceil(briefChars / 4);
  const list = providers?.length ? providers : [""];
  // Calls are spread over the participants, so the mean limit is used; large answers have their own (#147).
  const mean = (schemaName?: string) => list.reduce((sum, p) => sum + outputTokensFor(p, policy.maxOutputTokens, schemaName), 0) / list.length;
  const perPhase = estimateCalls(policy, participants, requirements);
  const largeCalls = perPhase.independentThinking + perPhase.consensusRound + perPhase.finalVerdict;
  const contextPerCall = briefTokens + participants * Math.min(policy.maxOutputTokens, 2_500) + 1_500;
  const upperBound = Math.ceil(calls * contextPerCall + largeCalls * mean("proposal") + (calls - largeCalls) * mean());
  return { calls, upperBound, withinBudget: upperBound <= policy.tokenBudget };
}
