import { COUNCIL_PHASE_LABELS, type CouncilPhase } from "@consyrium/core";

/** One grouped usage row of a session: calls of one participant in one phase with one outcome. */
export interface ParticipationUsageRow {
  participantId: string | null;
  phase: CouncilPhase | null;
  outcome: string;
  calls: number;
}

/** Phases in which every active model is asked: Independent Thinking, the 12 Minds Council (#136) and the Final Verdict. */
const EVERY_MODEL_PHASES: ReadonlySet<CouncilPhase> = new Set(["independent_thinking", "twelve_minds_council", "final_verdict"]);

export interface ValidParticipation {
  /** Participants that delivered a valid contribution in every phase they were called in. */
  valid: number;
  total: number;
  /** Whole percent, null before any model call. */
  percent: number | null;
  /** Participants that fell short, with the phases in which no call succeeded (empty: never called / dropped). */
  /** `notCalled`: phases in which the model was never asked (shortened by the budget), as opposed to failing calls. */
  shortfalls: { participantId: string; phases: string[]; notCalled?: string[] }[];
}

/**
 * Valid participation rate (#182): the share of participants that delivered a valid contribution in every phase that
 * ran for them. Derived from the stored usage records only – a phase counts as delivered when at least one of the
 * participant's calls in it ended "ok" (a retry that succeeds counts; error kinds since #175 say why the others
 * failed). A participant that was marked failed, or never made a successful call while others did, falls short.
 */
export function validParticipation(
  participants: ReadonlyArray<{ id: string; status: string }>,
  usage: ReadonlyArray<ParticipationUsageRow>,
): ValidParticipation {
  const rows = usage.filter((r) => r.participantId && r.phase && r.calls > 0);
  if (!rows.length || !participants.length) return { valid: 0, total: participants.length, percent: null, shortfalls: [] };
  // Gesamttest 08.11.26: phases in which every model is asked count for every model that ran in the council – a model
  // that was never called there (e.g. the 12 Minds Council shortened by the budget) did not deliver either.
  const ranForAll = [...new Set(rows.map((r) => r.phase!))].filter((phase) => EVERY_MODEL_PHASES.has(phase));
  const shortfalls = participants.flatMap((p) => {
    const own = rows.filter((r) => r.participantId === p.id);
    const phases = [...new Set([...own.map((r) => r.phase!), ...(own.length ? ranForAll : [])])];
    const missed = phases.filter((phase) => !own.some((r) => r.phase === phase && r.outcome === "ok"));
    const notCalled = missed.filter((phase) => !own.some((r) => r.phase === phase));
    if (missed.length === 0 && phases.length > 0 && p.status !== "failed") return [];
    return [
      {
        participantId: p.id,
        phases: missed.map((phase) => COUNCIL_PHASE_LABELS[phase]),
        ...(notCalled.length ? { notCalled: notCalled.map((phase) => COUNCIL_PHASE_LABELS[phase]) } : {}),
      },
    ];
  });
  const valid = participants.length - shortfalls.length;
  return { valid, total: participants.length, percent: Math.round((valid / participants.length) * 100), shortfalls };
}
