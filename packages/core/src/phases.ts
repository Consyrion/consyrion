/**
 * The seven official Consyrion decision phases. Names are canonical and must be used
 * unchanged in the workflow engine, the database and the UI (issue #58).
 */
export const COUNCIL_PHASES = [
  "independent_thinking",
  "open_council",
  "twelve_minds_council",
  "minority_review",
  "consensus_round",
  "final_verdict",
  "execution_council",
] as const;

export type CouncilPhase = (typeof COUNCIL_PHASES)[number];

export const COUNCIL_PHASE_LABELS: Record<CouncilPhase, string> = {
  independent_thinking: "Independent Thinking",
  open_council: "Open Council",
  twelve_minds_council: "12 Minds Council",
  minority_review: "Minority Review",
  consensus_round: "Consensus Round",
  final_verdict: "Final Verdict",
  execution_council: "Execution Council",
};

export const DECISION_MODES = ["independent_expert", "adversarial_review", "consensus"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export const DECISION_MODE_LABELS: Record<DecisionMode, string> = {
  independent_expert: "Independent Expert Mode",
  adversarial_review: "Adversarial Review Mode",
  consensus: "Consensus Mode",
};

/** The twelve default perspectives of the 12 Minds Council. The active subset is configurable. */
export const COUNCIL_ROLES = [
  "software_architect",
  "security_expert",
  "performance_engineer",
  "backend_engineer",
  "frontend_engineer",
  "database_architect",
  "devops_engineer",
  "cost_analyst",
  "product_strategist",
  "quality_assurance_expert",
  "maintainability_reviewer",
  "independent_critical_thinker",
] as const;

export type CouncilRole = (typeof COUNCIL_ROLES)[number];

export interface EvaluationWeights {
  technicalQuality: number;
  security: number;
  maintainability: number;
  operatingCost: number;
  implementationSpeed: number;
}

/** Default Final Verdict weights in percent; they must add up to 100. */
export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeights = {
  technicalQuality: 30,
  security: 25,
  maintainability: 20,
  operatingCost: 15,
  implementationSpeed: 10,
};

/**
 * One weight field as typed in the form (#97): the same rule as `validateWeights`, but per field and before the
 * request – a correct total must not hide a negative or empty single value.
 */
export function weightFieldError(raw: string): string | null {
  if (raw.trim() === "") return "Enter a number from 0 to 100.";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter a number from 0 to 100.";
  if (value < 0) return "Must not be negative.";
  if (value > 100) return "Must be at most 100.";
  return null;
}

export function validateWeights(weights: EvaluationWeights): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) errors.push(`${key} must be between 0 and 100`);
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 1e-9) errors.push(`weights must add up to 100 (got ${total})`);
  return errors;
}
