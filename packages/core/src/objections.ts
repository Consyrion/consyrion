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
