import { independenceKey } from "@consyrium/core/browser";
import type { View } from "./helpers";

/**
 * Participation per model and phase (ChatGPT P0, 09.11.26): which model really proposed, discussed, reviewed and
 * evaluated, and where its calls failed. Built only from stored rows – calls (usage records per phase and outcome),
 * proposals, debate messages and scores – never from what a phase was supposed to do.
 */
export const PARTICIPATION_PHASES = [
  "independent_thinking",
  "open_council",
  "twelve_minds_council",
  "minority_review",
  "consensus_round",
  "final_verdict",
] as const;
export type ParticipationPhase = (typeof PARTICIPATION_PHASES)[number];

export interface ParticipationCell {
  /** Successful model calls of this participant in this phase. */
  ok: number;
  /** Failed calls (error, refusal, invalid output, cut off). */
  failed: number;
  /** Stored contributions: proposal, debate messages, scores. */
  contributions: number;
}

export interface ParticipationRow {
  participantId: string;
  cells: Record<ParticipationPhase, ParticipationCell>;
  /**
   * User decision 08.11.26: the same model through several keys is one independent voice. Set when this participant is
   * one of several instances of its model (independenceKey), numbered in participant order.
   */
  instance?: { index: number; total: number };
}

const empty = (): ParticipationCell => ({ ok: 0, failed: 0, contributions: 0 });

export function participationMatrix(view: View): ParticipationRow[] {
  const usage = (view.usage ?? []) as Array<{ participantId: string | null; phase: string | null; outcome: string; calls: number }>;
  const messages = (view.messages ?? []) as Array<{ participantId: string | null; phase: string }>;
  const scores = (view.scores ?? []) as Array<{ evaluatorParticipantId: string }>;
  const groups = new Map<string, string[]>();
  for (const p of view.participants) {
    const key = independenceKey(p.provider, p.modelId);
    groups.set(key, [...(groups.get(key) ?? []), p.id]);
  }
  return view.participants.map((p) => {
    const cells = Object.fromEntries(PARTICIPATION_PHASES.map((phase) => [phase, empty()])) as Record<ParticipationPhase, ParticipationCell>;
    for (const u of usage) {
      if (u.participantId !== p.id || !u.phase || !(u.phase in cells)) continue;
      const cell = cells[u.phase as ParticipationPhase];
      if (u.outcome === "ok") cell.ok += Number(u.calls);
      else cell.failed += Number(u.calls);
    }
    cells.independent_thinking.contributions += view.proposals.filter((x) => x.authorParticipantId === p.id).length;
    for (const m of messages) if (m.participantId === p.id && m.phase in cells) cells[m.phase as ParticipationPhase].contributions += 1;
    // Scores belong to the Final Verdict (one per criterion and evaluated proposal); counted once per stored score.
    cells.final_verdict.contributions += scores.filter((s) => s.evaluatorParticipantId === p.id).length;
    const group = groups.get(independenceKey(p.provider, p.modelId))!;
    return { participantId: p.id, cells, ...(group.length > 1 ? { instance: { index: group.indexOf(p.id) + 1, total: group.length } } : {}) };
  });
}

/** A phase that ran but where this model has neither a successful call nor a contribution. */
export function silentIn(row: ParticipationRow, phase: ParticipationPhase, phaseRan: boolean): boolean {
  const c = row.cells[phase];
  return phaseRan && c.ok === 0 && c.contributions === 0;
}
