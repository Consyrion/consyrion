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
  /**
   * Sources for "Belege ansehen" (#267 stage 2): the stored objection row, the message it came from, the revision that
   * was attacked and the current one, with the stored times. Null fields were not stored – never filled in.
   */
  sources: {
    objectionId: string;
    raisedAt: string | null;
    message: { id: string; phase: string; round: number | null; body: string; createdAt: string | null } | null;
    attackedVersion: number | null;
    currentVersion: number | null;
    revisedAt: string | null;
  };
}

export type CruxFilter = "all" | "open" | "critical" | "resolved";

/** Which cruxes a filter chip keeps: open = still undecided, critical = high/critical or blocking, resolved = settled or moot. */
export function matchesFilter(c: Crux, filter: CruxFilter): boolean {
  // An upheld objection ("accepted") the proposal has not fixed yet is still open – same rule as the next steps (#273).
  if (filter === "open") return (c.status === "open" || c.status === "unresolved" || c.status === "accepted") && !c.revision?.moot;
  if (filter === "critical") return c.blocking || c.severity === "critical" || c.severity === "high";
  if (filter === "resolved") return c.status === "refuted" || c.status === "resolved" || Boolean(c.revision?.moot);
  return true;
}

const isoOf = (value: unknown) => {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

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

export function deriveCruxes(view: View, recommendedId: string | null, limit = 3, filter: CruxFilter = "all"): Crux[] {
  const messages = new Map((view.messages ?? []).map((m) => [m.id, m]));
  const all = ((view.objections ?? []) as Objection[]).map((o): Crux => {
    const proposal = view.proposals.find((p) => p.id === o.proposalId);
    const created = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    const revisions = proposal?.revisions ?? [];
    const later = revisions.filter((r) => r.createdAt && new Date(r.createdAt as string | Date).getTime() > created);
    const latest = later.at(-1);
    // The version the objection was raised against: the newest revision stored before it (#267: "damals v1, aktuell v2").
    const attacked = revisions.filter((r) => r.createdAt && new Date(r.createdAt as string | Date).getTime() <= created).at(-1);
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
      author: {
        by: modelName(view, proposal?.authorParticipantId),
        response: o.response ?? null,
        conceded: Boolean(o.conceded),
        unanswered: o.undefendedReason ?? null,
      },
      review: { by: o.reviewedByParticipantId ? modelName(view, o.reviewedByParticipantId) : null, reason: o.resolutionReason ?? null },
      revision: latest ? { version: latest.version, moot: Boolean(o.moot) } : o.moot ? { version: o.moot.currentVersion, moot: true } : null,
      recommended: o.proposalId === recommendedId,
      sources: {
        objectionId: o.id,
        raisedAt: isoOf(o.createdAt),
        message: source ? { id: source.id, phase: source.phase, round: source.round ?? null, body: source.body, createdAt: isoOf(source.createdAt) } : null,
        attackedVersion: attacked?.version ?? o.moot?.againstVersion ?? null,
        currentVersion: revisions.at(-1)?.version ?? null,
        revisedAt: isoOf(latest?.createdAt),
      },
    };
  });
  const weight = (c: Crux) =>
    (c.blocking ? 1000 : 0) + (c.revision?.moot ? -500 : 0) + STATUS_RANK[c.status] * 100 + (SEVERITY_RANK[c.severity] ?? 0) * 10 + (c.recommended ? 5 : 0);
  return all
    .filter((c) => matchesFilter(c, filter))
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, limit);
}

/**
 * True when the council got far enough to have disputes (Minority Review done or a verdict exists) but stored none:
 * then the card says "no documented dispute" instead of disappearing or inventing one (#267).
 */
export function noDocumentedDispute(view: View): boolean {
  if ((view.objections ?? []).length || remainingDisagreements(view).length) return false;
  const reviewDone = (view.stages ?? []).some((s) => s.phase === "minority_review" && s.status === "completed");
  return reviewDone || Boolean(view.decision);
}

/** Disagreements the Consensus Round left open, stored as written (no rewording). */
export function remainingDisagreements(view: View): string[] {
  return (view.consensus as { disagreements?: string[] } | null)?.disagreements ?? [];
}
