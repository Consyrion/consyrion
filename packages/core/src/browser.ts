/**
 * Browser-safe subset of @consyrium/core for client components: constants, labels, types and display helpers only.
 * No verdict, gate, strength, readiness or revision logic (#189) – the server computes those and sends the results.
 * Add names explicitly; scripts/check-client-bundle.mjs fails the build when engine logic reaches the browser.
 */
export {
  COUNCIL_PHASES,
  COUNCIL_PHASE_LABELS,
  COUNCIL_ROLES,
  DECISION_MODE_LABELS,
  weightFieldError,
  type CouncilPhase,
  type CouncilRole,
  type DecisionMode,
  type EvaluationWeights,
} from "./phases";
export { COUNCIL_PURPOSES, MAX_PARTICIPANTS, MAX_TOKEN_BUDGET, MIN_PARTICIPANTS, MIN_TOKEN_BUDGET, MODE_POLICIES, tokenBudgetError } from "./policy";
export type { CouncilPurpose } from "./policy";
export { CRITERIA, describeConfidenceIssue, type Confidence, type ConfidenceIssue, type Criterion } from "./verdict";
export { dedupeStatements, objectionStatusText } from "./objections";
export { MAX_TASK_ATTEMPTS, MIN_OVERRIDE_REASON } from "./readiness";
export { countLimits, describeMeasure, detectMeasure, type MeasureUnit, type RequirementMeasure } from "./requirement-measure";
export {
  measurableOnlyAfterImplementation,
  measurementPlanSuggestion,
  needsBuildVerification,
  requirementCheckability,
  requirementVerification,
  MEASUREMENT_CHECK_GATE_VERSION,
  type RequirementCheckability,
} from "./requirement-testability";
export type { StrengthSuggestion, VoteWeightWarning } from "./model-strength";
export {
  profilesAfterApply,
  roleSelectionSnapshot,
  suggestRoleProfiles,
  suggestRoles,
  type ProfileSuggestion,
  type RoleOrigin,
  type RoleSelectionSnapshot,
  type RoleSuggestion,
  type RoleSuggestionResult,
  type SuggestableProfile,
} from "./role-suggestion";
export { EXCLUSION_REASON_KEYS } from "./exclusion-reasons";
export { findRequirementConflicts, type RequirementConflict } from "./requirement-conflicts";
export { splitCoverageGaps, splitPartLetter, type RequirementDecomposition, type RequirementSplitRef } from "./requirement-split";
export { coverAllParticipants, type RoleCoverage } from "./role-coverage";
export { SKILL_PUBLICATION_LICENSE, SKILL_REPORT_REASONS, slugFromName, type SkillReviewStatus } from "./skill-publication";
export { awaitingReviewWithoutApproval } from "./approval-status";
export { independenceKey, independentGroupCount } from "./independence";
