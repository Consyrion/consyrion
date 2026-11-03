/**
 * Checks that an evaluator scored the proposal it named (#93). Proposal labels (A, B, …) can collide with options
 * the user named in the brief ("Option A = CSV, B = Push"); an evaluator that mixes them up scores one proposal
 * with arguments about another. The evaluator copies each proposal's title before scoring; that title binds the
 * scores (#145). Word similarity of summaries and rationales is only a warning: in German texts function words
 * dominate it, and after the Consensus Round revisions converge so far that it cannot tell proposals apart.
 */

const STOP = new Set(
  [
    "the and for with that this from are was were will would should could can not but its into than then them they their there these those about over under such only also more most very much each other which when what where who why how our your you use using used does done have has had been being per via any all may might must one two three like just own",
    // German function words (#145): without them they made up 35–66 % of a German proposal's word vector.
    "und oder der die das den dem des ein eine einer einem einen eines für mit von bei aus auf nach über unter durch gegen ohne ist sind war wird werden wurde kann können muss müssen soll sollte nicht auch als wie wenn dass damit daher dann noch nur sehr mehr alle alles jede jeder jedes diese dieser dieses sich wir ihr sie uns zum zur vom beim im ins am bis",
  ]
    .join(" ")
    .split(" "),
);

function words(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-zäöüß0-9]{3,}/g) ?? []) {
    if (STOP.has(raw)) continue;
    // Crude stemming so "exports" and "export" meet.
    const word = raw.length > 4 ? raw.replace(/(ing|ed|es|s)$/, "") : raw;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [w, v] of a) {
    na += v * v;
    const o = b.get(w);
    if (o) dot += v * o;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Distinct content words of a text (lower case, stop words removed, crudely stemmed). */
export function contentWords(text: string): Set<string> {
  return new Set(words(text).keys());
}

/** All text of a proposal's stored content (title, summary, architecture, lists …) as one string. */
export function proposalText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string" || typeof content === "number") return String(content);
  if (Array.isArray(content)) return content.map(proposalText).join(" ");
  if (typeof content === "object")
    return Object.values(content as Record<string, unknown>)
      .map(proposalText)
      .join(" ");
  return "";
}

export interface BindingProposal {
  label: string;
  text: string;
}

/** A clearly better match must win by this much (absolute and relative) to count as a mix-up. */
const MARGIN = 0.05;
const RATIO = 1.25;

/**
 * Returns the label of the proposal that `text` describes clearly better than `expected`, or null when the
 * expected proposal is the best (or an equally good) match.
 */
export function betterMatch(text: string, expected: string, proposals: BindingProposal[]): string | null {
  const bag = words(text);
  const scores = proposals.map((p) => ({ label: p.label, score: cosine(bag, words(p.text)) }));
  const own = scores.find((s) => s.label === expected)?.score ?? 0;
  const best = scores.filter((s) => s.label !== expected).sort((a, b) => b.score - a.score)[0];
  if (best && best.score > own + MARGIN && best.score > own * RATIO) return best.label;
  return null;
}

export interface ScoredEvaluation {
  proposalLabel: string;
  proposalTitle: string;
  proposalSummary: string;
  rationales: string[];
}

export interface BindingTitle {
  label: string;
  title: string;
}

/** Title words for comparison: lower case, accents folded, a leading "Proposal B:" dropped. */
export function titleWords(title: string): Set<string> {
  const plain = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\s*(proposal|vorschlag)\s+[a-z]\b\s*[:\-–]?/, "");
  return new Set(plain.match(/[a-z0-9ß]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** A restated title belongs to another proposal when it matches that title at least this well … */
const TITLE_MATCH = 0.6;
/** … and clearly better than the title of the proposal it names. */
const TITLE_MARGIN = 0.2;

/**
 * The label whose title the restated `title` copies instead of the named one, or null. Proposals with the same
 * title cannot be told apart by it and never count as a mix-up.
 */
export function titleMismatch(title: string, expected: string, titles: BindingTitle[]): string | null {
  const words = titleWords(title);
  const own = jaccard(words, titleWords(titles.find((t) => t.label === expected)?.title ?? ""));
  const best = titles
    .filter((t) => t.label !== expected)
    .map((t) => ({ label: t.label, score: jaccard(words, titleWords(t.title)) }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= TITLE_MATCH && best.score >= own + TITLE_MARGIN ? best.label : null;
}

export interface BindingResult {
  /** Message for the one corrective retry; null when every proposal shown was scored once under its own title. */
  problem: string | null;
  /** Labels whose scores must not be stored: the restated title is another proposal's (a real mix-up). */
  rejected: string[];
  /** Lexical doubts that never reject anything (#145): logged so the check can be tuned with real runs. */
  warnings: string[];
}

/**
 * Binding of an evaluator's answer (#93, #145). `scope` is what the evaluator saw; `all` includes every proposal of
 * the session (also the evaluator's own), so copying the title of a proposal it was not shown is caught too. Only
 * the affected proposal is rejected – correctly bound scores of the same evaluator stay valid.
 */
export function checkBinding(
  evaluations: ScoredEvaluation[],
  scope: Array<BindingProposal & BindingTitle>,
  all: Array<BindingProposal & BindingTitle>,
): BindingResult {
  const problems: string[] = [];
  const rejected = new Set<string>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const evaluation of evaluations) {
    const label = evaluation.proposalLabel.trim().toUpperCase();
    if (!scope.some((p) => p.label === label)) {
      problems.push(`"${evaluation.proposalLabel}" is not one of the proposals shown (${scope.map((p) => p.label).join(", ")})`);
      continue;
    }
    if (seen.has(label)) problems.push(`Proposal ${label} was scored twice`);
    seen.add(label);
    const copied = titleMismatch(evaluation.proposalTitle, label, all);
    if (copied) {
      problems.push(`the title you gave for Proposal ${label} is the title of Proposal ${copied}`);
      rejected.add(label);
      continue;
    }
    const summaryMatch = betterMatch(`${evaluation.proposalTitle} ${evaluation.proposalSummary}`, label, all);
    if (summaryMatch) warnings.push(`summary of Proposal ${label} reads closer to Proposal ${summaryMatch}`);
    const rationaleMatch = betterMatch(evaluation.rationales.join(" "), label, all);
    if (rationaleMatch) warnings.push(`rationales for Proposal ${label} read closer to Proposal ${rationaleMatch}`);
  }
  for (const p of scope) if (!seen.has(p.label)) problems.push(`Proposal ${p.label} was not scored`);
  return { problem: problems.length ? problems.join("; ") : null, rejected: [...rejected], warnings };
}
