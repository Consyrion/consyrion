import { contentWords } from "./binding";

/**
 * Checks the Consensus Round summary against the proposals' current revisions (#105). A moderator may repeat an
 * objection written against an earlier version ("Proposal B lacks staging and rollback") although the author has
 * since added exactly that. A statement that calls something missing from a proposal whose current text contains
 * most of those terms is flagged. Lexical only: it catches clear contradictions, it does not judge whether the
 * added measure is good enough – that stays "added by the author, not independently verified".
 */

export interface CurrentProposal {
  label: string;
  version: number;
  text: string;
}

export interface SummaryContradiction {
  statement: string;
  label: string;
  version: number;
  /** Terms the statement calls missing that the current revision contains. */
  present: string[];
}

const ABSENCE =
  /\b(lacks?|lacking|is missing|are missing|missing|omits?|omitting|without|no mention of|does not (?:include|have|mention|specify|address|cover|provide|detail|describe)|doesn't (?:include|have|mention|specify|address|cover|provide|detail|describe)|fails to (?:include|mention|address|specify|describe|provide))\b/i;
const LABEL = /\b(?:[Pp]roposal|[Oo]ption|[Ss]olution)\s+([A-Z])\b/g;
/** Words that describe the statement itself, not the measures it is about. */
const GENERIC = new Set(
  "proposal option solution approach emphasiz comprehensive detail detailing specific specifics aspect element measure process more less while whereas both other plan explicit explicitly clear clearly strong stronger weak weaker focus".split(" "),
);

function terms(text: string) {
  return [...contentWords(text)].filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/** Statements that describe as missing what a proposal's current revision contains. */
export function summaryContradictions(statements: string[], proposals: CurrentProposal[]): SummaryContradiction[] {
  const known = new Map(proposals.map((p) => [p.label, { ...p, words: contentWords(p.text) }]));
  const found: SummaryContradiction[] = [];
  for (const statement of statements) {
    const clauses = statement.split(/(?<=[.;])\s+|,?\s+\b(?:while|whereas|but)\b\s+/i);
    for (const [index, clause] of clauses.entries()) {
      const absence = ABSENCE.exec(clause);
      if (!absence) continue;
      // The proposal the clause is about: the last label named before the absence word.
      const labels = [...clause.slice(0, absence.index).matchAll(LABEL)].map((m) => m[1]!);
      const proposal = known.get(labels.at(-1) ?? "");
      if (!proposal) continue;
      let object = terms(clause.slice(absence.index + absence[0].length));
      // "… while Proposal B lacks these specifics": the measures are named in the previous clause.
      if (object.length < 2 && index > 0) object = terms(clauses[index - 1]!.replace(LABEL, ""));
      if (object.length < 2) continue;
      const present = object.filter((w) => proposal.words.has(w));
      if (present.length >= 2 && present.length / object.length >= 0.6) {
        found.push({ statement, label: proposal.label, version: proposal.version, present });
        break;
      }
    }
  }
  return found;
}

/** Visible caveat appended to a statement that still contradicts the current revision after one correction. */
export function contradictionCaveat(c: SummaryContradiction) {
  return `${c.statement} [Quality note: Proposal ${c.label} v${c.version} does contain ${c.present.slice(0, 4).join(", ")} – added by its author, not independently verified.]`;
}
