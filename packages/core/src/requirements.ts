import { DomainError } from "./errors";
import { detectMeasure, type RequirementMeasure } from "./requirement-measure";

/**
 * Requirement intake (#190): data contract, confirmation and binding checks. The user reviews, edits and confirms the
 * hard requirements of a brief before a council starts. The extraction rules that propose the list live server-side
 * in ./engine (`extractRequirements`); this module only defines what goes in and what comes out.
 */

export const REQUIREMENT_SOURCE_KINDS = ["requirements", "goal", "idea", "document", "user"] as const;
export type RequirementSourceKind = (typeof REQUIREMENT_SOURCE_KINDS)[number];

export interface RequirementSource {
  kind: RequirementSourceKind;
  documentId?: string;
  documentName?: string;
}

/** One statement the splitter found in the brief or a document. */
export interface RequirementCandidate {
  /** Stable for the same source and wording; links a confirmed item or exclusion back to its origin. */
  key: string;
  text: string;
  source: RequirementSource;
  /** Reads like an instruction to the AI models rather than a product requirement (directly or quoted). */
  suspectedInjection: boolean;
  /**
   * Why the statement needs the user's decision before a list can be confirmed (#227) – never kept or excluded by
   * default: `instruction` addresses the models; `quoted_instruction` only quotes such text (often a product
   * requirement about handling it as data); `meta_rule` says when a requirement counts as met instead of describing
   * the product. Absent: an ordinary candidate.
   */
  suspicion?: RequirementSuspicion;
}

export type RequirementSuspicion = "instruction" | "quoted_instruction" | "meta_rule";

export interface RequirementItem {
  /** R1…Rn, numbered per list version: an id is only unique together with its list (see `requirementRef`). */
  id: string;
  text: string;
  kind: "hard";
  source: RequirementSource;
  candidateKey: string | null;
  /** A time, monthly cost or availability limit found in the wording (requirement-measure.ts); evaluators estimate it. */
  measure?: RequirementMeasure | null;
}

export interface ExcludedRequirement {
  candidateKey: string;
  text: string;
  source: RequirementSource;
  reason: string;
}

export const REQUIREMENT_LIMITS = { maxItems: 100, maxItemChars: 1_000, maxCandidates: 150, minReasonChars: 3 } as const;

export {
  CONTEXT_EXCLUSION_REASON,
  DOCUMENT_EXCLUSION_REASON,
  DUPLICATE_EXCLUSION_REASON,
  INJECTION_EXCLUSION_REASON,
  INSTRUCTION_EXCLUSION_REASON,
  META_RULE_EXCLUSION_REASON,
  EXCLUSION_REASON_KEYS,
} from "./exclusion-reasons";

export function normalizeRequirementText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.;,]+$/, "")
    .toLowerCase();
}

export interface RequirementIntakeSource {
  idea: string;
  goal: string;
  requirements: string;
  documents: ReadonlyArray<{ id: string; name: string; content: string }>;
}

export interface RequirementProposal {
  candidates: RequirementCandidate[];
  /** Documents not read as prose (code, JSON, CSV …): the user adds their requirements by hand. */
  unscannedDocuments: Array<{ id: string; name: string }>;
  /** Statements beyond `maxCandidates` that were not proposed; shown, never silently dropped. */
  notProposed: number;
}

/** What the user submits when confirming. */
export interface RequirementConfirmationInput {
  items: ReadonlyArray<{ text: string; candidateKey?: string | null }>;
  excluded: ReadonlyArray<{ candidateKey: string; reason: string }>;
  /** Required – and only allowed – when the list is empty: the user states that the brief has no hard requirement. */
  noHardRequirements?: boolean;
}

/**
 * Checks a confirmation against the current candidates and returns the list to store. Every candidate must be kept
 * as an item or excluded with a reason – nothing disappears silently – and an excluded statement cannot be kept at
 * the same time. Sources come from the server's candidates, never from the client; items without a current candidate
 * are the user's own. Ids R1…Rn follow the submitted order.
 */
export function buildConfirmedRequirements(
  candidates: ReadonlyArray<RequirementCandidate>,
  input: RequirementConfirmationInput,
): { items: RequirementItem[]; excluded: ExcludedRequirement[]; noHardRequirements: boolean } {
  const problems: string[] = [];
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  if (input.items.length > REQUIREMENT_LIMITS.maxItems) problems.push(`At most ${REQUIREMENT_LIMITS.maxItems} requirements per list`);

  const excluded: ExcludedRequirement[] = [];
  const excludedKeys = new Set<string>();
  for (const entry of input.excluded) {
    const candidate = byKey.get(entry.candidateKey);
    if (!candidate) continue; // the statement is no longer in the brief: nothing left to exclude
    if (excludedKeys.has(candidate.key)) continue;
    const reason = entry.reason.trim();
    if (reason.length < REQUIREMENT_LIMITS.minReasonChars) problems.push(`Give a reason for not taking over: "${short(candidate.text)}"`);
    excludedKeys.add(candidate.key);
    excluded.push({ candidateKey: candidate.key, text: candidate.text, source: candidate.source, reason: reason.slice(0, 500) });
  }

  const items: RequirementItem[] = [];
  const keptKeys = new Set<string>();
  const texts = new Set<string>();
  for (const entry of input.items) {
    const text = entry.text.replace(/\s+/g, " ").trim();
    if (!text) {
      problems.push("A requirement is empty – fill it in or remove it");
      continue;
    }
    if (text.length > REQUIREMENT_LIMITS.maxItemChars) problems.push(`A requirement can have at most ${REQUIREMENT_LIMITS.maxItemChars} characters`);
    const normalized = normalizeRequirementText(text);
    if (texts.has(normalized)) problems.push(`Listed twice: "${short(text)}"`);
    texts.add(normalized);
    const candidate = entry.candidateKey ? byKey.get(entry.candidateKey) : undefined;
    if (candidate) {
      if (excludedKeys.has(candidate.key)) problems.push(`Both kept and excluded: "${short(candidate.text)}"`);
      if (keptKeys.has(candidate.key)) problems.push(`Taken over twice: "${short(candidate.text)}"`);
      keptKeys.add(candidate.key);
    }
    items.push({
      id: `R${items.length + 1}`,
      text: text.slice(0, REQUIREMENT_LIMITS.maxItemChars),
      kind: "hard",
      source: candidate ? candidate.source : { kind: "user" },
      candidateKey: candidate ? candidate.key : null,
      measure: detectMeasure(text),
    });
  }
  for (const entry of excluded) {
    if (texts.has(normalizeRequirementText(entry.text))) problems.push(`Excluded but listed again as a requirement: "${short(entry.text)}"`);
  }

  const undecided = candidates.filter((c) => !keptKeys.has(c.key) && !excludedKeys.has(c.key));
  if (undecided.length)
    problems.push(
      `${undecided.length} proposed statement(s) are neither kept nor excluded with a reason: ${undecided
        .slice(0, 3)
        .map((c) => `"${short(c.text)}"`)
        .join(", ")}${undecided.length > 3 ? " …" : ""}`,
    );

  const noHardRequirements = input.noHardRequirements === true;
  if (items.length === 0 && !noHardRequirements) problems.push("The list is empty. Add the hard requirements, or confirm explicitly that this brief has none.");
  if (items.length > 0 && noHardRequirements) problems.push("The list has requirements, so it cannot be confirmed as having none");

  if (problems.length) throw new DomainError("VALIDATION", problems[0]!, { problems });
  return { items, excluded, noHardRequirements };
}

function short(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Globally unambiguous reference: "R1" alone means nothing without its list version. */
export function requirementRef(listId: string, itemId: string): string {
  return `${listId}#${itemId}`;
}

/**
 * Whether a stored check refers to this exact requirement: same list version, same id and – as a guard against
 * reused ids – the same wording. A check against V1-R1 never satisfies V2-R1.
 */
export function checkBelongsToRequirement(
  check: { requirementListId: string | null | undefined; requirementId: string; requirement?: string },
  list: { id: string; items: ReadonlyArray<Pick<RequirementItem, "id" | "text">> },
  itemId: string,
): boolean {
  if (check.requirementListId !== list.id || check.requirementId !== itemId) return false;
  const item = list.items.find((i) => i.id === itemId);
  if (!item) return false;
  return check.requirement === undefined || normalizeRequirementText(check.requirement) === normalizeRequirementText(item.text);
}
