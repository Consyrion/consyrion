import { splitCoverageGaps, type RequirementDecomposition } from "../requirement-split";

/**
 * Requirement decomposition rules (#216) – server-side only, deterministic, no model. Proposes to split ONE confirmed
 * statement into independently checkable parts; the user takes the proposal over, edits it or keeps the original.
 *
 * Deliberately conservative:
 * - Only an enumeration separated by commas or semicolons is split – never at "and/und" inside an item, so
 *   "encryption at rest and in transit" stays one part. An optional "Topic:" prefix is repeated in every part.
 * - Conditions that depend on each other (when, if, afterwards, during, bei, danach …) are marked "coupled".
 * - When a split could change the meaning it is "unclear" instead: alternatives (or/oder), a leading negation or
 *   restriction that may cover every item ("no …, …"), a modal verb or subject that only the first item carries
 *   ("must A, B and C"), a main verb that only the first item carries ("The system needs A, B and C"), very short
 *   items, or a number/negation that no part would keep.
 * - Parts are pieces of the original wording: nothing is rephrased and nothing (number, unit, negation) is lost.
 */

const MAX_PARTS = 8;
/** Connector at the start of the last item ("…, and C"). */
const LEADING_CONNECTOR = /^(?:und|sowie|plus|and|as well as)\s+/i;
const ALTERNATIVE = /^(?:oder|bzw\.?|beziehungsweise|or|either)\s+/i;
const COUPLING =
  /\b(?:danach|anschließend|daraufhin|dann|wenn|falls|sofern|sobald|solange|während|bevor|nachdem|bei|bis|then|afterwards|after|before|if|when|whenever|while|unless|until|once|in case|as long as)\b/iu;
/** A leading word whose scope may cover every item of the enumeration. */
const SHARED_SCOPE_START =
  /^(?:kein|keine|keinen|keiner|keinem|keines|nie|niemals|nicht|weder|nur|ausschließlich|alle|jede|jeder|jedes|no|not|never|neither|none|only|exclusively|all|every|each)\b/iu;
const MODAL =
  /\b(?:muss|müssen|musst|soll|sollen|sollte|sollten|darf|dürfen|kann|können|wird|werden|must|shall|should|may|can|will|has to|have to|needs? to)\b/iu;
/**
 * A finite main verb in the first item ("Das System braucht A, B und C"): the later items are only its objects, so a
 * split would leave parts without subject and verb (live check 08.11.26). Telegraphic items without a verb still split.
 */
const SHARED_VERB =
  /\b(?:braucht|brauchen|benötigt|benötigen|erfordert|erfordern|bietet|bieten|unterstützt|unterstützen|enthält|enthalten|umfasst|umfassen|hat|haben|ist|sind|nutzt|nutzen|verwendet|verwenden|speichert|speichern|liefert|liefern|erhält|erhalten|need|needs|require|requires|support|supports|provide|provides|include|includes|offer|offers|has|have|is|are|use|uses|store|stores|contain|contains|deliver|delivers|get|gets)\b/iu;
/** An item that continues the first item's subject ("…, be encrypted …"): splitting would lose the subject. */
const CONTINUES_SUBJECT =
  /^(?:be|is|are|was|has|have|must|should|shall|can|will|may|support|supports|allow|allows|provide|provides|offer|offers|run|runs|use|uses|keep|keeps|store|stores|ist|sind|hat|haben|muss|müssen|soll|sollen|kann|können|wird|werden|darf|dürfen|zu)\b/iu;

/** Top-level pieces between ", " / "; " – not inside brackets or quotes, not "1,5" (no space after the comma). */
function segments(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote) {
      if (ch === quote || (quote === "„" && ch === "“")) quote = null;
      continue;
    }
    if (ch === '"' || ch === "„" || ch === "«") quote = ch === "«" ? "»" : ch;
    else if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;
    else if (depth === 0 && (ch === "," || ch === ";") && /\s/.test(body[i + 1] ?? "")) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** A split proposal for one requirement text, or null when it is a single statement. */
export function decomposeRequirement(text: string): RequirementDecomposition | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = /[.!]$/.test(clean) ? clean.slice(-1) : "";
  const stripped = end ? clean.slice(0, -1) : clean;
  // "Datenschutz: A, B, C" – the topic before the colon belongs to every part.
  const colon = /^([^:,;]{3,80}):\s+(.+)$/.exec(stripped);
  const prefix = colon ? `${colon[1]}: ` : "";
  const body = colon ? colon[2]! : stripped;
  const raw = segments(body);
  if (raw.length < 2) return null;
  if (raw.length > MAX_PARTS) return { kind: "unclear", reason: "shared_scope" };
  if (raw.some((s, i) => i > 0 && ALTERNATIVE.test(s)) || /\s(?:oder|or)\s[^,;]*$/i.test(raw.at(-1)!)) return { kind: "unclear", reason: "alternatives" };
  if (raw.some((s) => COUPLING.test(s))) return { kind: "coupled" };
  const items = raw.map((s, i) => (i > 0 ? s.replace(LEADING_CONNECTOR, "") : s));
  if (SHARED_SCOPE_START.test(items[0]!)) return { kind: "unclear", reason: "shared_scope" };
  if (items.some((s, i) => i > 0 && CONTINUES_SUBJECT.test(s))) return { kind: "unclear", reason: "shared_scope" };
  for (const verb of [MODAL, SHARED_VERB]) {
    if (verb.test(items[0]!) && items.some((s, i) => i > 0 && !verb.test(s))) return { kind: "unclear", reason: "shared_scope" };
  }
  if (items.some((s) => words(s) < 2)) return { kind: "unclear", reason: "shared_scope" };
  const parts = items.map((s) => `${prefix}${s}${end}`);
  if (splitCoverageGaps(clean, parts).length) return { kind: "unclear", reason: "coverage" };
  return { kind: "split", parts };
}
