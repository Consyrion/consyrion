import { COUNCIL_PHASES, type CouncilPhase } from "@consyrium/core/browser";
import type { View } from "./helpers";

/**
 * Replay of a council from stored rows only (#271, part 1). Every event is exactly one persisted row with its own
 * timestamp – stage start/end, proposal revision, debate message, objection, Minority Review, scores, vote, consensus,
 * verdict, human decision. Nothing is generated: no quotes, no estimated times, no reconstructed events. Rows without a
 * timestamp are left out and counted, so the screen can say that detail is missing.
 */
export type ReplayKind =
  | "stage_started"
  | "stage_completed"
  | "revision"
  | "message"
  | "objection"
  | "minority_review"
  | "scores"
  | "vote"
  | "consensus"
  | "decision"
  | "approval";

export type ReplayEvent = {
  /** Stable key: kind plus the stored row id (or phase / participant for grouped rows). */
  id: string;
  kind: ReplayKind;
  /** ISO timestamp exactly as stored. */
  at: string;
  phase: CouncilPhase | null;
  participantId: string | null;
  proposalId: string | null;
  /** Kind-specific stored values for the event card (never generated text). */
  data: Record<string, string | number | boolean | null>;
};

/** Order among rows with the same timestamp: a phase starts before its content, ends after it. */
const ORDER: Record<ReplayKind, number> = {
  stage_started: 0,
  revision: 1,
  message: 2,
  objection: 3,
  minority_review: 4,
  scores: 5,
  vote: 6,
  consensus: 7,
  decision: 8,
  stage_completed: 9,
  approval: 10,
};

const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function buildReplayEvents(view: View): { events: ReplayEvent[]; withoutTime: number } {
  const events: ReplayEvent[] = [];
  let withoutTime = 0;
  const push = (event: Omit<ReplayEvent, "at"> & { at: unknown }) => {
    const at = iso(event.at);
    if (!at) {
      withoutTime++;
      return;
    }
    events.push({ ...event, at });
  };

  for (const stage of view.stages ?? []) {
    const phase = stage.phase as CouncilPhase;
    if (stage.startedAt)
      push({ id: `stage_started:${phase}`, kind: "stage_started", at: stage.startedAt, phase, participantId: null, proposalId: null, data: {} });
    if (stage.completedAt)
      push({
        id: `stage_completed:${phase}`,
        kind: "stage_completed",
        at: stage.completedAt,
        phase,
        participantId: null,
        proposalId: null,
        data: { status: stage.status },
      });
  }
  for (const proposal of view.proposals ?? []) {
    for (const revision of proposal.revisions ?? []) {
      const content = (revision.content ?? {}) as { title?: string };
      push({
        id: `revision:${revision.id}`,
        kind: "revision",
        at: revision.createdAt,
        phase: (revision.phase as CouncilPhase) ?? null,
        // The author stays hidden until the verdict (authorParticipantId is null before), as everywhere else.
        participantId: proposal.authorParticipantId ?? null,
        proposalId: proposal.id,
        data: { label: proposal.label, version: revision.version, title: content.title ?? null },
      });
    }
  }
  for (const message of view.messages ?? []) {
    push({
      id: `message:${message.id}`,
      kind: "message",
      at: message.createdAt,
      phase: message.phase as CouncilPhase,
      participantId: message.participantId ?? null,
      proposalId: message.targetProposalId ?? null,
      data: {
        messageKind: message.kind,
        role: message.role ?? null,
        round: message.round ?? null,
        severity: message.severity ?? null,
        category: message.category ?? null,
        body: message.body,
      },
    });
  }
  for (const objection of view.objections ?? []) {
    push({
      id: `objection:${objection.id}`,
      kind: "objection",
      at: objection.createdAt,
      // The phase of the stored message the objection came from; unknown stays unknown instead of guessed.
      phase: ((view.messages ?? []).find((m) => m.id === objection.sourceMessageId)?.phase as CouncilPhase | undefined) ?? null,
      participantId: objection.raisedByParticipantId ?? null,
      proposalId: objection.proposalId,
      // The decision has no own timestamp; the screen shows it only as the final state (see replayState).
      data: { claim: objection.claim, severity: objection.severity, category: objection.category, status: objection.status },
    });
  }
  if (view.minorityReview)
    push({
      id: "minority_review",
      kind: "minority_review",
      at: view.minorityReview.createdAt,
      phase: "minority_review",
      participantId: null,
      proposalId: view.minorityReview.favoredProposalId ?? null,
      data: { independentModels: view.minorityReview.independentModelCount ?? null, reevaluation: Boolean(view.minorityReview.reevaluationTriggered) },
    });
  // Scores: one event per evaluator, at the time of its last stored score (each score row has its own time).
  const byEvaluator = new Map<string, { at: string; count: number }>();
  for (const score of view.scores ?? []) {
    const at = iso(score.createdAt);
    if (!at) {
      withoutTime++;
      continue;
    }
    const entry = byEvaluator.get(score.evaluatorParticipantId) ?? { at, count: 0 };
    byEvaluator.set(score.evaluatorParticipantId, { at: at > entry.at ? at : entry.at, count: entry.count + 1 });
  }
  for (const [participantId, { at, count }] of byEvaluator)
    push({ id: `scores:${participantId}`, kind: "scores", at, phase: "final_verdict", participantId, proposalId: null, data: { count } });
  for (const vote of view.votes ?? [])
    push({
      id: `vote:${vote.id}`,
      kind: "vote",
      at: vote.createdAt,
      phase: "final_verdict",
      participantId: vote.evaluatorParticipantId,
      proposalId: null,
      data: {},
    });
  if (view.consensus)
    push({
      id: "consensus",
      kind: "consensus",
      at: view.consensus.createdAt,
      phase: "consensus_round",
      participantId: null,
      proposalId: null,
      data: { status: view.consensus.status },
    });
  for (const decision of [...(view.previousDecisions ?? []), ...(view.decision ? [view.decision] : [])])
    push({
      id: `decision:${decision.id}`,
      kind: "decision",
      at: decision.createdAt,
      phase: "final_verdict",
      participantId: null,
      proposalId: decision.recommendedProposalId ?? null,
      data: { outcome: decision.outcome, superseded: Boolean(decision.supersededAt) },
    });
  for (const approval of view.approvals ?? [])
    push({
      id: `approval:${approval.id}`,
      kind: "approval",
      at: approval.createdAt,
      phase: "final_verdict",
      participantId: null,
      proposalId: approval.selectedProposalId ?? null,
      data: { action: approval.action, comment: approval.comment || null },
    });

  // Stable order: time, then the phase (an earlier phase ends before a later one starts at the same second), then the
  // fixed kind order, then the id – the same after every reload.
  const phaseIndex = (e: ReplayEvent) => (e.phase ? COUNCIL_PHASES.indexOf(e.phase) : COUNCIL_PHASES.length);
  events.sort(
    (a, b) =>
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || phaseIndex(a) - phaseIndex(b) || ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { events, withoutTime };
}

export type PhaseState = "pending" | "running" | "completed" | "failed";

/** What was known at the cursor: phase states, counts, and whether the objection decisions are already final. */
export function replayState(view: View, events: ReplayEvent[], cursor: number) {
  const seen = events.slice(0, cursor + 1);
  const phases = Object.fromEntries(COUNCIL_PHASES.map((phase) => [phase, "pending" as PhaseState])) as Record<CouncilPhase, PhaseState>;
  for (const event of seen) {
    if (!event.phase) continue;
    if (event.kind === "stage_started" && phases[event.phase] === "pending") phases[event.phase] = "running";
    if (event.kind === "stage_completed") phases[event.phase] = event.data.status === "failed" ? "failed" : "completed";
  }
  const current = [...COUNCIL_PHASES].reverse().find((phase) => phases[phase] === "running") ?? null;
  return {
    phases,
    current,
    messages: seen.filter((e) => e.kind === "message").length,
    objections: seen.filter((e) => e.kind === "objection").length,
    /** Objection decisions carry no time of their own: they are shown only once the replay reaches the last event. */
    objectionDecisionsFinal: cursor >= events.length - 1,
    atEnd: cursor >= events.length - 1,
    /** Failed models are failed from the start – the time of the dropout is not stored, so they are never shown as active. */
    failedParticipants: view.participants.filter((p) => p.status === "failed").map((p) => p.id),
  };
}

export type EdgeKind = "question" | "critique" | "answer" | "objection";
export type ReplayEdge = { key: string; participantId: string; proposalId: string; kind: EdgeKind; eventIds: string[] };

const EDGE_KIND: Record<string, EdgeKind | undefined> = { question: "question", critique: "critique", rebuttal: "critique", answer: "answer" };

/**
 * Connections of the network view (#271 part 3): model → proposal, one per stored message or objection up to the
 * cursor, grouped by kind. Only rows that name both a model and a proposal count – no inferred or "activity" lines,
 * and no model → model edges (that would reveal authors before the verdict).
 */
export function replayEdges(events: ReplayEvent[], cursor: number): ReplayEdge[] {
  const edges = new Map<string, ReplayEdge>();
  for (const event of events.slice(0, cursor + 1)) {
    if (!event.participantId || !event.proposalId) continue;
    const kind = event.kind === "objection" ? "objection" : event.kind === "message" ? EDGE_KIND[String(event.data.messageKind)] : undefined;
    if (!kind) continue;
    const key = `${event.participantId}|${event.proposalId}|${kind}`;
    const edge = edges.get(key) ?? { key, participantId: event.participantId, proposalId: event.proposalId, kind, eventIds: [] };
    edge.eventIds.push(event.id);
    edges.set(key, edge);
  }
  return [...edges.values()];
}
