/**
 * Wording for objections raised in the 12 Minds Council and decided in the Minority Review (#169).
 *
 * The status belongs to the objection, not to the proposal statement it attacks: "accepted" means the objection
 * was found correct. Report, web UI and VS Code all render it through these helpers so it never reads as if the
 * council had confirmed the criticised statement.
 */
export type ObjectionStatus = "open" | "refuted" | "resolved" | "accepted" | "unresolved";

export const OBJECTION_STATUS_TEXT: Record<ObjectionStatus, string> = {
  open: "objection open",
  refuted: "objection refuted",
  resolved: "objection resolved by the proposal",
  accepted: "objection accepted",
  unresolved: "objection unresolved",
};

export function objectionStatusText(status: string): string {
  return OBJECTION_STATUS_TEXT[status as ObjectionStatus] ?? `objection ${status}`;
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * One line per objection: who objected against which proposal, the objection itself, the reasoning behind it and how
 * it was decided. Older runs may hold the attacked statement in `claim` (the field was undefined before #169) – the
 * evidence that follows it still makes clear that it is the subject of an objection.
 */
export function describeObjection(o: {
  proposal: string;
  raisedBy: string;
  claim: string;
  evidence?: string | null;
  status: string;
  resolution?: string | null;
  blocking?: boolean;
}): string {
  const evidence = o.evidence ? collapse(o.evidence) : "";
  const resolution = o.resolution ? collapse(o.resolution) : "";
  return [
    `Objection by ${o.raisedBy} against Proposal ${o.proposal}: ${collapse(o.claim)}`,
    evidence ? ` Reasoning: ${evidence}` : "",
    ` – ${objectionStatusText(o.status)}`,
    resolution ? ` (${resolution})` : "",
    o.blocking ? " – blocks approval" : "",
  ].join("");
}

/** Lower-case, punctuation and whitespace removed – for spotting the same sentence written by several proposals. */
export function normalizeStatement(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Removes exact and normalised duplicates (case, punctuation, whitespace), keeping the first wording (#173).
 * Statements that say the same in different words stay – deciding that would need a model.
 */
export function dedupeStatements(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeStatement(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/** Content words of a statement: normalised, at least 4 characters (drops articles, "und", "the", short numbers). */
function contentWords(value: string): Set<string> {
  return new Set(
    normalizeStatement(value)
      .split(" ")
      .filter((word) => word.length >= 4),
  );
}

/** Share of the shorter statement's content words that the other one contains too. */
export const SAME_POINT_OVERLAP = 0.6;

/**
 * Night test 07.11.26: one model raised the same point against the same proposal several times – from several of its
 * roles and again in the second debate round, each time slightly reworded (68 objections, many near-identical). Two
 * statements count as the same point when the shorter one's content words are at least SAME_POINT_OVERLAP contained
 * in the other. Only used within one model, one proposal and one category: different models are independent voices
 * and always stay separate.
 */
export function sameObjectionPoint(a: string, b: string): boolean {
  if (normalizeStatement(a) === normalizeStatement(b)) return true;
  const wa = contentWords(a);
  const wb = contentWords(b);
  const smaller = wa.size <= wb.size ? wa : wb;
  const larger = smaller === wa ? wb : wa;
  if (smaller.size < 5) return false;
  let shared = 0;
  for (const word of smaller) if (larger.has(word)) shared++;
  return shared / smaller.size >= SAME_POINT_OVERLAP;
}
