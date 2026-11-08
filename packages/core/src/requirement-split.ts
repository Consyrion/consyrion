/**
 * Splitting a requirement into independently checkable parts (#216) – the browser-safe half: data shape and the
 * coverage check. The rules that PROPOSE a split are server-side (engine/requirement-decomposition.ts); the user
 * confirms, edits or rejects every split, and the original text stays referenced by each part.
 */

/** What the server suggests for one requirement. */
export type RequirementDecomposition =
  /** Independent parts, each a piece of the original wording (nothing rewritten, nothing left out). */
  | { kind: "split"; parts: string[] }
  /** Conditions that belong together ("offline … and afterwards synchronise …"): checked as one requirement. */
  | { kind: "coupled" }
  /** Looks like several requirements, but the split is ambiguous: the user decides instead of a silent split. */
  | { kind: "unclear"; reason: "alternatives" | "shared_scope" | "coverage" };

/** A confirmed part of a split requirement: the original statement and the part's position (1-based) and count. */
export interface RequirementSplitRef {
  text: string;
  part: number;
  of: number;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const NEGATION =
  /\b(?:nicht|kein|keine|keinen|keiner|keinem|keines|nie|niemals|nur|ausschließlich|ohne|verboten|untersagt|not|no|never|none|only|exclusively|without|forbidden|prohibited)\b/giu;

const tokens = (text: string) => [...new Set([...(text.match(NUMBER) ?? []), ...(text.toLowerCase().match(NEGATION) ?? [])])];

/**
 * Numbers and negation/restriction words of the original that no part contains (#216, owner rule 1). Empty = every
 * number, every negation and every "only" of the original survives in at least one part. Units travel with their
 * number inside the same piece of wording, so a number that survives keeps its unit.
 */
export function splitCoverageGaps(original: string, parts: readonly string[]): string[] {
  const joined = parts.join("\n").toLowerCase();
  const partTokens = new Set(tokens(joined));
  return tokens(original).filter((t) => !partTokens.has(t.toLowerCase()));
}

/** "a", "b", … for part 1, 2, … (display only; requirement ids stay positional R1…Rn). */
export function splitPartLetter(part: number): string {
  return part >= 1 && part <= 26 ? String.fromCharCode(96 + part) : String(part);
}
