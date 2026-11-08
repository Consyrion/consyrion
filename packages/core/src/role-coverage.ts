import type { CouncilRole } from "./phases";

/**
 * #136: six models but four perspectives – the round-robin left two models without a role, so they gave no critical
 * review and no preference in the 12 Minds Council. Every selected model now gets at least one perspective: models
 * without a role receive an extra role that is not chosen yet, generalist reviewers first. Nobody gets an extra vote –
 * a role is a review perspective, the vote stays one per model.
 */
const FALLBACK_ORDER: readonly CouncilRole[] = [
  "independent_critical_thinker",
  "maintainability_reviewer",
  "quality_assurance_expert",
  "performance_engineer",
  "devops_engineer",
  "database_architect",
  "backend_engineer",
  "product_strategist",
  "security_expert",
  "cost_analyst",
  "software_architect",
  "frontend_engineer",
];

export interface RoleCoverage {
  /** One entry per role: which participant (by position) takes it. */
  assignments: Array<{ role: CouncilRole; participantIndex: number }>;
  /** Roles added so that every participant has one (shown before the start). */
  added: Array<{ role: CouncilRole; participantIndex: number }>;
}

export function coverAllParticipants(
  roles: readonly CouncilRole[],
  participants: number,
  explicit?: ReadonlyArray<{ role: CouncilRole; participantIndex: number }>,
): RoleCoverage {
  const assignments = roles.map((role, index) => ({
    role,
    participantIndex: explicit?.find((a) => a.role === role)?.participantIndex ?? index % Math.max(1, participants),
  }));
  const covered = new Set(assignments.map((a) => a.participantIndex));
  const unused = FALLBACK_ORDER.filter((role) => !roles.includes(role));
  const added: RoleCoverage["added"] = [];
  for (let index = 0; index < participants; index++) {
    if (covered.has(index)) continue;
    const role = unused.shift();
    if (!role) break; // 12 roles cover any allowed team size; never reached with at most 6 models.
    added.push({ role, participantIndex: index });
  }
  return { assignments: [...assignments, ...added], added };
}
