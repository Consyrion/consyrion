/**
 * Consensus Round revisions (#94): "position kept" and "content unchanged" are different things. A revision may
 * keep its core recommendation and still has to carry the corrections its author promised. These checks compare
 * what the model claims with what actually changed.
 */

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Same content regardless of key order. */
export function sameContent(a: unknown, b: unknown) {
  return stable(a) === stable(b);
}

/** Top-level fields whose value differs – the structured diff a revision is judged by. */
export function changedFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => stable(a[key]) !== stable(b[key]));
}

const POSITION_ONLY = /^position kept\.?$/i;

export interface RevisionAnswer {
  keepPosition: boolean;
  content: unknown;
  changes: Array<{ change: string; motivatedBy: string[] }>;
}

export interface RevisionObjection {
  id: string;
  conceded: boolean;
  status: string;
}

/**
 * Null when the answer is consistent; otherwise one message for the corrective retry:
 * - changes are claimed but the content is identical to the current version;
 * - an objection the author conceded is not followed by any content change (a missing id reference alone is
 *   tolerated – real models often omit it; the objection is then noted as "content changed, not linked").
 */
export function revisionProblem(before: unknown, answer: RevisionAnswer, objections: RevisionObjection[]): string | null {
  const problems: string[] = [];
  const changed = changedFields(before, answer.content).length > 0;
  const claimed = answer.changes.filter((c) => c.change.trim() && !POSITION_ONLY.test(c.change.trim()));
  if (claimed.length > 0 && !changed) problems.push(`you listed ${claimed.length} change(s) but returned content identical to the current version – apply them to the content`);
  for (const objection of objections) {
    if (!objection.conceded || objection.status === "refuted" || objection.status === "resolved") continue;
    if (!changed) problems.push(`objection ${objection.id} was conceded – fix it in the content and reference its id in motivatedBy (keeping the position is fine)`);
  }
  return problems.length ? problems.join("; ") : null;
}
