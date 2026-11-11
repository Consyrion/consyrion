import type { ValidParticipation } from "./participation";

/**
 * #182 – process quality of one council, derived only from stored data (no model call, no benchmark). Every figure says
 * what it measures and where it stops: it describes how the council worked, it is no proof that the verdict is right.
 */
export interface ProcessQuality {
  /** Valid participation (#182 part 1, `validParticipation`), per participant. */
  participation: ValidParticipation | null;
  /**
   * The same counted per independence group (#522: instances of one model are one voice): a group counts as valid when
   * at least one of its instances delivered in every phase it was called in.
   */
  participationGroups: { valid: number; total: number } | null;
  convergence: Convergence;
  objections: ObjectionEffect;
  weight: WeightDominance;
}

/**
 * Convergence (herd effect): word overlap (Jaccard of normalised word sets from title, summary, architecture and
 * components) between the proposals, first versions against latest revisions. Word overlap is not equal content.
 */
export type Convergence =
  | { measurable: false; reason: "fewer_than_two_proposals" | "no_revisions" }
  | {
      measurable: true;
      /** Mean pairwise overlap of the first versions and of the latest revisions, 0–1. */
      initial: number;
      latest: number;
      /** latest − initial: positive = the proposals moved towards each other. */
      delta: number;
      level: "strong" | "moderate" | "little";
      /** Per proposal: 1 − overlap(first version, latest revision); 0 = unchanged wording. */
      drift: Array<{ proposalId: string; drift: number }>;
    };

/** What became of the objections (Minority Review): survival and a structural – not causal – effect per objection. */
export interface ObjectionEffect {
  total: number;
  /** Still standing at the end: accepted or unresolved (also conceded ones). */
  survived: number;
  refuted: number;
  resolved: number;
  open: number;
  /** For every surviving objection: did a later revision follow, does it block, or no visible effect. */
  effects: { revised: number; blocking: number; none: number };
}

export type WeightDominance =
  | { measurable: false; reason: "no_verdict" | "no_weights" | "no_winner" }
  | {
      measurable: true;
      /** Share of the whole vote held by the strongest independence group (instances of one model are one group). */
      topGroupShare: number;
      topGroupParticipantIds: string[];
      groups: number;
      /** The verdict compared the weighted with an equal vote and the winner differed (stored confidence issue #140). */
      changedWinner: boolean;
      weightedWinnerId: string | null;
      unweightedWinnerId: string | null;
    };

const STOP = new Set(
  "the and for with that this from are was were will into onto over under about which their there than then they them have has had not but its it's our your you all any can may must should would could also only more most less such each per via der die das und oder mit für von auf ist sind wird werden ein eine einer eines dem den des im in zu zur zum als auch nur nicht bei aus wie wenn dass oder sowie über unter durch".split(
    " ",
  ),
);

function words(content: unknown): Set<string> {
  const c = (content ?? {}) as { title?: unknown; summary?: unknown; architecture?: unknown; components?: unknown };
  const text = [c.title, c.summary, c.architecture, ...(Array.isArray(c.components) ? c.components : [])].filter((x) => typeof x === "string").join(" ");
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function meanPairwise(sets: Set<string>[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      sum += jaccard(sets[i]!, sets[j]!);
      n++;
    }
  return n ? sum / n : 0;
}

export function convergenceOf(proposals: ReadonlyArray<{ id: string; revisions: ReadonlyArray<{ version: number; content: unknown }> }>): Convergence {
  const withRevisions = proposals.filter((p) => p.revisions.length > 0);
  if (withRevisions.length < 2) return { measurable: false, reason: "fewer_than_two_proposals" };
  const first = withRevisions.map((p) => [...p.revisions].sort((a, b) => a.version - b.version)[0]!);
  const latest = withRevisions.map((p) => [...p.revisions].sort((a, b) => b.version - a.version)[0]!);
  if (latest.every((r, i) => r.version === first[i]!.version)) return { measurable: false, reason: "no_revisions" };
  const initial = meanPairwise(first.map((r) => words(r.content)));
  const last = meanPairwise(latest.map((r) => words(r.content)));
  const delta = last - initial;
  return {
    measurable: true,
    initial: round2(initial),
    latest: round2(last),
    delta: round2(delta),
    // Thresholds on the word-overlap scale: a rise of 0.15 means a clearly larger shared vocabulary.
    level: delta >= 0.15 ? "strong" : delta >= 0.05 ? "moderate" : "little",
    drift: withRevisions.map((p, i) => ({ proposalId: p.id, drift: round2(1 - jaccard(words(first[i]!.content), words(latest[i]!.content))) })),
  };
}

export function objectionEffectOf(
  objections: ReadonlyArray<{ proposalId: string; status: string; blocking: boolean; createdAt: Date | string; moot?: unknown }>,
  revisions: ReadonlyArray<{ proposalId: string; version: number; createdAt: Date | string }>,
): ObjectionEffect {
  const at = (d: Date | string) => new Date(d).getTime();
  const effect: ObjectionEffect = { total: objections.length, survived: 0, refuted: 0, resolved: 0, open: 0, effects: { revised: 0, blocking: 0, none: 0 } };
  for (const o of objections) {
    if (o.status === "refuted") effect.refuted++;
    else if (o.status === "resolved") effect.resolved++;
    else if (o.status === "open") effect.open++;
    if (o.status !== "accepted" && o.status !== "unresolved") continue;
    effect.survived++;
    // Structural, not causal: a revision of the same proposal after the objection, or the point became moot.
    const revised = Boolean(o.moot) || revisions.some((r) => r.proposalId === o.proposalId && r.version > 1 && at(r.createdAt) > at(o.createdAt));
    if (o.blocking) effect.effects.blocking++;
    else if (revised) effect.effects.revised++;
    else effect.effects.none++;
  }
  return effect;
}

type StoredMatrix = {
  evaluatorWeights?: Record<string, number>;
  evaluatorGroups?: Record<string, string>;
  confidenceIssues?: Array<{ kind: string; weightedWinnerId?: string | null; unweightedWinnerId?: string | null }>;
} | null;

export function weightDominanceOf(matrix: unknown, recommendedProposalId: string | null): WeightDominance {
  const m = matrix as StoredMatrix;
  if (!m) return { measurable: false, reason: "no_verdict" };
  const weights = m.evaluatorWeights;
  if (!weights || Object.keys(weights).length === 0) return { measurable: false, reason: "no_weights" };
  const groupOf = (id: string) => m.evaluatorGroups?.[id] ?? `participant:${id}`;
  const byGroup = new Map<string, { weight: number; ids: string[] }>();
  for (const [id, w] of Object.entries(weights)) {
    const g = byGroup.get(groupOf(id)) ?? { weight: 0, ids: [] };
    // One voice per group (#522): instances share their group's weight – the strongest instance counts.
    g.weight = Math.max(g.weight, Number(w) || 1);
    g.ids.push(id);
    byGroup.set(groupOf(id), g);
  }
  const total = [...byGroup.values()].reduce((a, g) => a + g.weight, 0);
  const top = [...byGroup.values()].sort((a, b) => b.weight - a.weight)[0]!;
  const changed = (m.confidenceIssues ?? []).find((i) => i.kind === "weighting_changed_winner");
  // Gesamttest 08.11.26: without an approvable winner "the weights did not change the winner" says nothing.
  if (!changed && !recommendedProposalId) return { measurable: false, reason: "no_winner" };
  return {
    measurable: true,
    topGroupShare: round2(total ? top.weight / total : 0),
    topGroupParticipantIds: top.ids,
    groups: byGroup.size,
    changedWinner: Boolean(changed),
    weightedWinnerId: changed ? (changed.weightedWinnerId ?? null) : recommendedProposalId,
    unweightedWinnerId: changed ? (changed.unweightedWinnerId ?? null) : recommendedProposalId,
  };
}

export function processQuality(input: {
  participation: ValidParticipation | null;
  participantIds: ReadonlyArray<string>;
  proposals: ReadonlyArray<{ id: string; revisions: ReadonlyArray<{ proposalId: string; version: number; content: unknown; createdAt: Date | string }> }>;
  objections: ReadonlyArray<{ proposalId: string; status: string; blocking: boolean; createdAt: Date | string; moot?: unknown }>;
  decision: { matrix: unknown; recommendedProposalId: string | null } | null;
}): ProcessQuality {
  const groups = (input.decision?.matrix as StoredMatrix)?.evaluatorGroups;
  const groupOf = (id: string) => groups?.[id] ?? `participant:${id}`;
  const short = new Set(input.participation?.shortfalls.map((x) => x.participantId) ?? []);
  const allGroups = new Set(input.participantIds.map(groupOf));
  const validGroups = new Set(input.participantIds.filter((id) => !short.has(id)).map(groupOf));
  return {
    participation: input.participation,
    participationGroups: input.participation ? { valid: validGroups.size, total: allGroups.size } : null,
    convergence: convergenceOf(input.proposals),
    objections: objectionEffectOf(
      input.objections,
      input.proposals.flatMap((p) => p.revisions),
    ),
    weight: input.decision ? weightDominanceOf(input.decision.matrix, input.decision.recommendedProposalId) : { measurable: false, reason: "no_verdict" },
  };
}
