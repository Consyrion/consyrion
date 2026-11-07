import { modelName, proposalLabel, roleLabel, type View } from "./helpers";

/**
 * Key disputes ("cruxes", #267): the 1–3 disagreements that actually decided or still threaten the verdict, built
 * deterministically from stored council events – objections with the author's response and the independent review,
 * revisions after the objection and the Consensus Round's remaining disagreements. No model call, no generated text:
 * every sentence shown is a stored statement or a fixed label, and it links back to its source.
 */

export type CruxStatus = "open" | "unresolved" | "accepted" | "refuted" | "resolved";

export interface Crux {
  id: string;
  proposalId: string;
  proposal: string;
  severity: string;
  category: string;
  status: CruxStatus;
  /** True when it blocks approval (unresolved critical security risk). */
  blocking: boolean;
  claim: { text: string; by: string; role: string | null; evidence: string | null };
  author: { by: string; response: string | null; conceded: boolean; unanswered: string | null };
  review: { by: string | null; reason: string | null };
  /** Revision of the attacked proposal after the objection, if any; moot = the revision removed what was attacked. */
  revision: { version: number; moot: boolean } | null;
  /** Concerns the recommended proposal. */
  recommended: boolean;
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
/** Still open or confirmed by the review outranks a dispute the review settled against the objection. */
const STATUS_RANK: Record<CruxStatus, number> = { unresolved: 4, open: 4, accepted: 3, resolved: 1, refuted: 1 };

type Objection = View["objections"][number] & {
  moot?: { againstVersion: number; currentVersion: number } | null;
  sourceMessageId?: string | null;
  reviewedByParticipantId?: string | null;
  conceded?: boolean;
  undefendedReason?: string | null;
  createdAt?: string | Date;
};

export function deriveCruxes(view: View, recommendedId: string | null, limit = 3): Crux[] {
  const messages = new Map((view.messages ?? []).map((m) => [m.id, m]));
  const all = ((view.objections ?? []) as Objection[]).map((o): Crux => {
    const proposal = view.proposals.find((p) => p.id === o.proposalId);
    const created = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    const later = (proposal?.revisions ?? []).filter((r) => r.createdAt && new Date(r.createdAt as string | Date).getTime() > created);
    const latest = later.at(-1);
    const source = o.sourceMessageId ? messages.get(o.sourceMessageId) : undefined;
    return {
      id: o.id,
      proposalId: o.proposalId,
      proposal: proposalLabel(view, o.proposalId),
      severity: o.severity,
      category: o.category ?? "",
      status: o.status as CruxStatus,
      blocking: Boolean(o.blocking),
      claim: { text: o.claim, by: modelName(view, o.raisedByParticipantId), role: source?.role ? roleLabel(source.role) : null, evidence: o.evidence || null },
      author: { by: modelName(view, proposal?.authorParticipantId), response: o.response ?? null, conceded: Boolean(o.conceded), unanswered: o.undefendedReason ?? null },
      review: { by: o.reviewedByParticipantId ? modelName(view, o.reviewedByParticipantId) : null, reason: o.resolutionReason ?? null },
      revision: latest ? { version: latest.version, moot: Boolean(o.moot) } : o.moot ? { version: o.moot.currentVersion, moot: true } : null,
      recommended: o.proposalId === recommendedId,
    };
  });
  const weight = (c: Crux) =>
    (c.blocking ? 1000 : 0) + (c.revision?.moot ? -500 : 0) + STATUS_RANK[c.status] * 100 + (SEVERITY_RANK[c.severity] ?? 0) * 10 + (c.recommended ? 5 : 0);
  return all.sort((a, b) => weight(b) - weight(a)).slice(0, limit);
}

/** Disagreements the Consensus Round left open, stored as written (no rewording). */
export function remainingDisagreements(view: View): string[] {
  return (view.consensus as { disagreements?: string[] } | null)?.disagreements ?? [];
}
