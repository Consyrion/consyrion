import { createHash } from "node:crypto";
import {
  assertCan,
  buildConfirmedRequirements,
  CONTEXT_EXCLUSION_REASON,
  DOCUMENT_EXCLUSION_REASON,
  DUPLICATE_EXCLUSION_REASON,
  detectMeasure,
  DomainError,
  INJECTION_EXCLUSION_REASON,
  INSTRUCTION_EXCLUSION_REASON,
  META_RULE_EXCLUSION_REASON,
  REQUIREMENT_LIMITS,
  type ExcludedRequirement,
  type RequirementCandidate,
  type RequirementDecomposition,
  type RequirementSource,
  type RequirementSuspicion,
} from "@consyrium/core";
import { assertNotDemoProject } from "./demo";

export { CONTEXT_EXCLUSION_REASON, DOCUMENT_EXCLUSION_REASON };
import { decomposeRequirement, extractRequirements, withoutQuotes } from "@consyrium/core/engine";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { projectBrief, projectDocument, requirementList } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { getProject, lockProjectSources, assertProjectWritable } from "./projects";

/**
 * Requirement intake (#190): proposal, confirmation and the start check. The list a council runs on is the one the
 * user confirmed for the current brief version and the current set of documents – nothing else.
 */

export type RequirementList = typeof requirementList.$inferSelect;
export type RequirementSourceState = RequirementList["sourceState"];

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The brief fields and documents a list is confirmed against, with the hash that identifies this exact state. */
export async function requirementSourceState(db: Database, ctx: ActorContext, projectId: string) {
  assertCan(ctx.role, "project:read");
  await getProject(db, ctx, projectId);
  const [brief] = await db.select().from(projectBrief).where(eq(projectBrief.projectId, projectId)).orderBy(desc(projectBrief.version)).limit(1);
  if (!brief) throw new DomainError("CONFLICT", "Project has no brief");
  const documents = await db
    .select({
      id: projectDocument.id,
      name: projectDocument.name,
      content: projectDocument.content,
      descriptionStatus: projectDocument.descriptionStatus,
      role: projectDocument.role,
    })
    .from(projectDocument)
    .where(and(eq(projectDocument.projectId, projectId), eq(projectDocument.organizationId, ctx.organizationId)))
    .orderBy(asc(projectDocument.createdAt), asc(projectDocument.id));
  /** Images whose description is not confirmed yet: no list can be confirmed and no council can start (docs/documents.md). */
  const pendingImages = documents.filter((d) => d.descriptionStatus !== null && d.descriptionStatus !== "confirmed").map((d) => d.name);
  const state: RequirementSourceState = {
    briefId: brief.id,
    briefVersion: brief.version,
    documents: documents.map((d) => ({ id: d.id, name: d.name, sha256: sha256(d.content) })),
  };
  const hash = sha256(
    JSON.stringify({
      briefId: brief.id,
      idea: brief.idea,
      goal: brief.goal,
      requirements: brief.requirements,
      documents: [...state.documents].sort((a, b) => a.id.localeCompare(b.id)).map((d) => [d.id, d.sha256]),
    }),
  );
  return { brief, documents, state, hash, pendingImages };
}

export async function latestRequirementList(db: Database, ctx: ActorContext, projectId: string): Promise<RequirementList | null> {
  assertCan(ctx.role, "project:read");
  const [row] = await db
    .select()
    .from(requirementList)
    .where(and(eq(requirementList.projectId, projectId), eq(requirementList.organizationId, ctx.organizationId)))
    .orderBy(desc(requirementList.version))
    .limit(1);
  return row ?? null;
}

export async function getRequirementList(db: Database, ctx: ActorContext, listId: string): Promise<RequirementList> {
  assertCan(ctx.role, "project:read");
  const [row] = await db
    .select()
    .from(requirementList)
    .where(and(eq(requirementList.id, listId), eq(requirementList.organizationId, ctx.organizationId)));
  if (!row) throw new DomainError("NOT_FOUND", "Requirement list not found");
  return row;
}

/** Every confirmed version of a project's list, newest first; historic versions stay readable. */
export async function listRequirementLists(db: Database, ctx: ActorContext, projectId: string) {
  assertCan(ctx.role, "project:read");
  await getProject(db, ctx, projectId);
  return db
    .select()
    .from(requirementList)
    .where(and(eq(requirementList.projectId, projectId), eq(requirementList.organizationId, ctx.organizationId)))
    .orderBy(desc(requirementList.version));
}

export interface ProposedItem {
  text: string;
  candidateKey: string | null;
  source: RequirementSource;
  /** Not in the previously confirmed list: a new statement in the brief or a new document. */
  isNew: boolean;
  /** Carried over from the previous list, but its statement is no longer in the brief or its document was removed. */
  sourceGone: boolean;
  /** Part of a split requirement (#216): the original statement it came from. */
  splitFrom?: string | null;
  /** #216: suggestion to split this statement into independently checkable parts (deterministic, no model). */
  decomposition?: RequirementDecomposition | null;
}

/**
 * What the confirmation screen shows. Without a confirmed list: every candidate as an item, suspected injections as
 * excluded. With one: the confirmed items and exclusions are carried over (with the user's edits), new statements are
 * added and marked, and items whose source disappeared are marked – the user decides, nothing is dropped silently.
 */
/** Binding wording ("muss", "spätestens", "only", a measurable limit) keeps an idea/goal sentence a requirement. */
const BINDING =
  /\b(muss|müssen|darf|dürfen|must|shall|required?|only|nur|ausschließlich|mindestens|höchstens|maximal|spätestens|at least|at most|never|niemals|keine?n?)\b/i;
/** R2-03: a sentence that calls itself background ("nur Hintergrundinformation", "for context only") is context. */
/**
 * R2-01/R2-02 (night test 08.11.26): a sentence about the options to choose from ("Änderungen sind bei A sofort, bei
 * B …", "Alle drei Lösungen speichern …") or about the decision itself ("A logistics SaaS must choose how …") describes
 * the situation; "must" or "ausschließlich" inside it made it a hard requirement.
 */
const OPTION_FACT =
  /(?<![\p{L}\d])(?:bei|für|von|option|variante|alternative|angebot)\s+[A-H](?![\p{L}\d])|\balle\s+(?:zwei|drei|vier|fünf|\d+)\s+(?:lösungen|angebote|alternativen|optionen|varianten|anbieter|vorschläge)\b|\ball\s+(?:two|three|four|five|\d+)\s+(?:alternatives|options|solutions|offers|vendors|proposals)\b|\b(?:must|has to|needs to)\s+(?:choose|decide|select|pick)\b|\bmuss\s+(?:sich\s+)?(?:entscheiden|wählen|auswählen)\b/iu;
/**
 * GitHub build test 08.11.26 (R3, ChatGPT P3): "Die Implementierung soll möglichst unter 80 Zeilen bleiben" is a
 * preference, not a hard requirement – "keine" inside it made it binding. Soft wording proposes an idea/goal sentence
 * as context; one click keeps it.
 */
const SOFT_WORDING =
  /\b(?:möglichst|idealerweise|nach\s+möglichkeit|wenn\s+möglich|wo\s+möglich|tendenziell|preferably|ideally|if\s+possible|where\s+possible|as\s+far\s+as\s+possible)\b/i;
const SELF_CONTEXT =
  /\b(?:hintergrund\w*|kontextinformation\w*|nur\s+(?:zur\s+)?(?:info\w*|kontext)|historische\s+angabe|background(?:\s+information)?|for\s+context|context\s+only|historical\s+(?:note|figure|information))\b/i;
/**
 * R2-04 (night test 08.11.26): "Benenne bei einem Widerspruch die Anforderungsnummern …", "Gib keine Lösung frei." –
 * an idea or goal sentence that starts with an imperative tells the council what to do in this run; "keine" inside it
 * made it binding. It is proposed as excluded with its own reason; one click keeps it.
 */
const WORK_INSTRUCTION =
  /^\s*(?:bitte\s+)?(?:prüfe|vergleiche|benenne|nenne|erkläre|erläutere|zeige|gib|bewerte|empfiehl|beschreibe|begründe|liste|analysiere|ermögliche|dokumentiere|fasse|unterscheide|entscheide|check|compare|name|list|explain|show|give|evaluate|assess|recommend|describe|justify|analy[sz]e|document|summari[sz]e|distinguish|clearly\s+distinguish|do\s+not|don't)\b/i;
/** R2-02: a rule for the evaluators ("Eine abweichende Bewertung darf nicht allein durch Autorenschaft … entstehen"). */
const EVALUATION_RULE =
  /^\s*(?:(?:eine|die|jede|keine)\s+)?(?:\w+e\s+)?(?:bewertung|beurteilung|prüfung|begutachtung)(?:en)?\b|^\s*(?:(?:an?|the|each|every|no)\s+)?(?:\w+\s+)?(?:evaluation|assessment|review|rating)s?\s+(?:must|should|may|shall)\b/i;
/** R2-01: the language of the council's own texts ("All proposals … must be in English") – the answer-language line
 *  handles it (#339); it is no product requirement. */
const OUTPUT_LANGUAGE =
  /\b(?:proposals?|critiques?|evaluations?|answers?|responses?|reasoning|outputs?|vorschläge|bewertungen|antworten|begründung\w*|ausgaben?)\b.{0,160}?\b(?:in|auf)\s+(?:english|englisch|german|deutsch|french|französisch|spanish|spanisch)\b/i;
/**
 * R3 (ChatGPT P3): rules about CONSYRIUM's own workflow ("Kein automatischer Merge.", "Der Draft-PR soll durch die
 * bestehende Pipeline geprüft werden") describe how the build is delivered – CONSYRIUM only opens draft pull requests
 * and never merges – not what the product must do.
 */
const WORKFLOW_RULE =
  /\b(?:(?:kein|keine|keinen|no)\s+(?:automatische[nr]?\s+|automatic\s+)?(?:merge|auto-?merge)|auto-?merge|draft-?(?:pull-?request|pr)\b|pull[-\s]request\s+(?:must|should|soll|muss))/i;
export function isWorkInstruction(text: string): boolean {
  return WORK_INSTRUCTION.test(text) || EVALUATION_RULE.test(text) || OUTPUT_LANGUAGE.test(text) || WORKFLOW_RULE.test(text);
}
/**
 * R2-04 (night test 08.11.26): the idea restated R1/R2 in reported speech ("Die Geschäftsführung hat verlangt, dass
 * sämtliche Audit-Logs spätestens nach sieben Tagen gelöscht werden") and became R7/R8 next to them. An idea or goal
 * sentence with the same numbers and at least three shared word stems as a requirements-field item repeats it.
 */
const NUMBER_WORDS: Record<string, string> = {
  ein: "1",
  eine: "1",
  one: "1",
  zwei: "2",
  two: "2",
  drei: "3",
  three: "3",
  vier: "4",
  four: "4",
  fünf: "5",
  five: "5",
  sechs: "6",
  six: "6",
  sieben: "7",
  seven: "7",
  acht: "8",
  eight: "8",
  neun: "9",
  nine: "9",
  zehn: "10",
  ten: "10",
  zwölf: "12",
  twelve: "12",
  dreißig: "30",
  thirty: "30",
};
function fingerprint(text: string) {
  const words =
    withoutQuotes(text)
      .toLowerCase()
      .match(/[\p{L}\d]+/gu) ?? [];
  const numbers = new Set<string>();
  const stems = new Set<string>();
  for (const w of words) {
    if (/^\d+$/.test(w)) numbers.add(w);
    else if (NUMBER_WORDS[w]) numbers.add(NUMBER_WORDS[w]);
    else if (w.length >= 5) stems.add(w.slice(0, 5));
  }
  return { numbers, stems };
}
function repeats(text: string, of: string): boolean {
  const a = fingerprint(text);
  const b = fingerprint(of);
  if (a.numbers.size === 0 || [...a.numbers].some((n) => !b.numbers.has(n))) return false;
  return [...a.stems].filter((s) => b.stems.has(s)).length >= 3;
}

function soundsBinding(text: string): boolean {
  const own = withoutQuotes(text);
  if (SELF_CONTEXT.test(own) || OPTION_FACT.test(own) || SOFT_WORDING.test(own)) return false;
  return BINDING.test(own) || detectMeasure(own) !== null;
}

/**
 * #245: a document sentence without binding wording of its own – a table row, a measured value, an observation – is
 * proposed as excluded: shown, and one click keeps it. A measured value alone ("Ping 15–18 ms") is not binding; a limit
 * is ("unter 200 ms", "≥ 99,95 %", "innerhalb von vier Stunden"), and so are "muss", "only", "sind … aufzubewahren",
 * "ohne …", "revisionssicher" … outside quotation marks (external review 31.10.26: recall before precision).
 */
const LIMIT =
  // Letter lookarounds instead of \b: "über" starts with a letter \b does not count as a word character.
  /(?:[≥≤<>]|(?<![\p{L}\d])(?:unter|über|innerhalb|binnen|spätestens|maximal|mindestens|weniger als|mehr als|bis zu|below|under|above|over|within|less than|more than|up to|no more than)(?![\p{L}\d]))\s*(?:von\s+)?(?:\d|(?:ein|eine|einem|einer|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|zwölf|one|two|three|four|five|six|seven|eight|nine|ten|twelve)(?![\p{L}\d]))/iu;
const OBLIGATION =
  /\b(?:ist|sind)\b[^.]{0,80}?\b\w+zu\w+en\b|\b(?:is|are)\s+to\s+be\b|\b(?:ohne|without|erforderlich|notwendig|verpflichtend|zwingend|pflicht\w*|revisionssicher\w*|verschlüsselt\w*|dsgvo\w*|gdpr|barrierefrei\w*|mandatory|encrypted)\b/i;
function documentSoundsBinding(text: string): boolean {
  // "nicht nur bei DeepSeek" / "not only" adds, it does not restrict.
  const own = withoutQuotes(text).replace(/\b(?:nicht nur|not only)\b/gi, " ");
  return BINDING.test(own) || LIMIT.test(own) || OBLIGATION.test(own);
}

export async function proposeRequirementList(db: Database, ctx: ActorContext, projectId: string) {
  const source = await requirementSourceState(db, ctx, projectId);
  const latest = await latestRequirementList(db, ctx, projectId);
  const proposal = extractRequirements({
    idea: source.brief.idea,
    goal: source.brief.goal,
    requirements: source.brief.requirements,
    // A repository context describes the project; it is read by the models but proposes no requirements.
    documents: source.documents.filter((d) => d.role !== "context"),
  });
  const byKey = new Map(proposal.candidates.map((c) => [c.key, c]));
  const items: ProposedItem[] = [];
  const excluded: ExcludedRequirement[] = [];
  const toDecide: Array<{ candidateKey: string; text: string; source: RequirementSource; suspicion: RequirementSuspicion; suggestedReason: string }> = [];
  const decided = new Set<string>();
  const exclude = (c: RequirementCandidate, reason: string) => {
    excluded.push({ candidateKey: c.key, text: c.text, source: c.source, reason });
    decided.add(c.key);
  };
  if (latest) {
    for (const item of latest.items) {
      const candidate = item.candidateKey ? byKey.get(item.candidateKey) : undefined;
      if (candidate) decided.add(candidate.key);
      items.push({
        text: item.text,
        candidateKey: candidate ? candidate.key : null,
        source: candidate ? candidate.source : item.source,
        isNew: false,
        sourceGone: item.source.kind !== "user" && !candidate,
        splitFrom: item.splitFrom?.text ?? null,
        decomposition: item.splitFrom ? null : decomposeRequirement(item.text),
      });
    }
    for (const entry of latest.excluded) {
      const candidate = byKey.get(entry.candidateKey);
      if (candidate && !decided.has(candidate.key)) exclude(candidate, entry.reason);
    }
  }
  // Test cases 30.10.26: sentences of the idea or goal are usually context ("as cheap as possible"). When the brief has
  // its own requirements (field or documents), they are proposed as excluded – shown, and one click keeps them.
  const hasRequirementSource = proposal.candidates.some((c) => c.source.kind === "requirements" || c.source.kind === "document");
  const fieldTexts = proposal.candidates.filter((c) => c.source.kind === "requirements").map((c) => c.text);
  for (const candidate of proposal.candidates) {
    if (decided.has(candidate.key)) continue;
    // #227: an instruction to the models, a quoted one or a rule about the evaluation is put to the user – neither
    // kept nor excluded by default; the list cannot be confirmed before each is decided.
    if (candidate.suspicion)
      toDecide.push({
        candidateKey: candidate.key,
        text: candidate.text,
        source: candidate.source,
        suspicion: candidate.suspicion,
        suggestedReason: candidate.suspicion === "meta_rule" ? META_RULE_EXCLUSION_REASON : INJECTION_EXCLUSION_REASON,
      });
    else if ((candidate.source.kind === "idea" || candidate.source.kind === "goal") && fieldTexts.some((field) => repeats(candidate.text, field)))
      exclude(candidate, DUPLICATE_EXCLUSION_REASON);
    else if (hasRequirementSource && (candidate.source.kind === "idea" || candidate.source.kind === "goal") && isWorkInstruction(candidate.text))
      exclude(candidate, INSTRUCTION_EXCLUSION_REASON);
    else if (hasRequirementSource && (candidate.source.kind === "idea" || candidate.source.kind === "goal") && !soundsBinding(candidate.text))
      exclude(candidate, CONTEXT_EXCLUSION_REASON);
    else if (candidate.source.kind === "document" && !documentSoundsBinding(candidate.text)) exclude(candidate, DOCUMENT_EXCLUSION_REASON);
    else {
      items.push({
        text: candidate.text,
        candidateKey: candidate.key,
        source: candidate.source,
        isNew: Boolean(latest),
        sourceGone: false,
        decomposition: decomposeRequirement(candidate.text),
      });
      decided.add(candidate.key);
    }
  }
  return {
    source: { ...source.state, hash: source.hash },
    latest,
    /** The latest confirmed list matches the current brief and documents: a council can start on it. */
    current: Boolean(latest && latest.sourceHash === source.hash),
    items,
    excluded,
    toDecide,
    unscannedDocuments: proposal.unscannedDocuments,
    /** Images without a confirmed description; the list cannot be confirmed while this is not empty. */
    pendingImages: source.pendingImages,
    notProposed: proposal.notProposed,
    limits: REQUIREMENT_LIMITS,
  };
}

export const requirementConfirmationInput = z.object({
  /** The source hash the user reviewed; a change in between needs a new review. */
  sourceHash: z.string().min(1),
  items: z
    .array(
      z.object({
        text: z.string().max(REQUIREMENT_LIMITS.maxItemChars * 2),
        candidateKey: z.string().max(100).nullish(),
        /** #216: original text of a split requirement; its parts share it. */
        splitFrom: z
          .string()
          .max(REQUIREMENT_LIMITS.maxItemChars * 2)
          .nullish(),
      }),
    )
    .max(REQUIREMENT_LIMITS.maxItems * 2),
  excluded: z.array(z.object({ candidateKey: z.string().max(100), reason: z.string().max(2_000) })).max(REQUIREMENT_LIMITS.maxCandidates * 2),
  noHardRequirements: z.boolean().optional(),
});

/** Stores a new confirmed version. Refused when the brief or documents changed since the user's review. */
export async function confirmRequirementList(db: Database, ctx: ActorContext, projectId: string, input: z.input<typeof requirementConfirmationInput>) {
  // The demo project is read-only (owner decision 08.11.26, review of #374).
  await assertNotDemoProject(db, ctx, projectId);
  // #197: an archived project is read-only.
  await assertProjectWritable(db, ctx, projectId);
  assertCan(ctx.role, "project:write");
  const parsed = requirementConfirmationInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid requirement list", z.flattenError(parsed.error));
  const data = parsed.data;
  const source = await requirementSourceState(db, ctx, projectId);
  if (data.sourceHash !== source.hash)
    throw new DomainError("CONFLICT", "The brief or its documents changed while you reviewed the requirements. Review the updated list and confirm again.");
  assertNoPendingImages(source.pendingImages);
  const { candidates } = extractRequirements({
    idea: source.brief.idea,
    goal: source.brief.goal,
    requirements: source.brief.requirements,
    // A repository context describes the project; it is read by the models but proposes no requirements.
    documents: source.documents.filter((d) => d.role !== "context"),
  });
  const confirmed = buildConfirmedRequirements(candidates, data);
  return db.transaction(async (tx) => {
    // Serialised with brief/document changes and council starts (#181 review): the source state is checked again under
    // the project lock, so a confirmation never binds to a state that changed meanwhile.
    await lockProjectSources(tx, projectId);
    if ((await requirementSourceState(tx, ctx, projectId)).hash !== source.hash)
      throw new DomainError("CONFLICT", "The brief or its documents changed while you reviewed the requirements. Review the updated list and confirm again.");
    const [{ current } = { current: 0 }] = await tx
      .select({ current: max(requirementList.version) })
      .from(requirementList)
      .where(eq(requirementList.projectId, projectId));
    const version = (current ?? 0) + 1;
    const [row] = await tx
      .insert(requirementList)
      .values({
        id: newId("rql"),
        organizationId: ctx.organizationId,
        projectId,
        version,
        briefId: source.brief.id,
        sourceHash: source.hash,
        sourceState: source.state,
        items: confirmed.items,
        excluded: confirmed.excluded,
        noHardRequirements: confirmed.noHardRequirements,
        confirmedById: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "project.requirements_confirmed",
      targetType: "project",
      targetId: projectId,
      metadata: { version, items: confirmed.items.length, excluded: confirmed.excluded.length, briefVersion: source.brief.version },
    });
    return row!;
  });
}

/**
 * The start check (#190): the latest confirmed list must match the current brief version and documents. Returns the
 * list and the source state a new council is frozen to; throws a CONFLICT that says what to do otherwise.
 */
export async function assertCurrentRequirementList(db: Database, ctx: ActorContext, projectId: string) {
  const source = await requirementSourceState(db, ctx, projectId);
  assertNoPendingImages(source.pendingImages);
  const list = await latestRequirementList(db, ctx, projectId);
  if (!list) throw new DomainError("CONFLICT", "Confirm the requirement list of this project before starting a council.");
  if (list.sourceHash !== source.hash)
    throw new DomainError(
      "CONFLICT",
      `The brief or its documents changed after requirement list version ${list.version} was confirmed. Review and confirm the requirements again before starting a council.`,
    );
  if (list.items.length === 0 && !list.noHardRequirements) throw new DomainError("CONFLICT", "The confirmed requirement list is empty. Confirm it again.");
  return { list, state: source.state };
}

function assertNoPendingImages(names: string[]) {
  if (names.length)
    throw new DomainError(
      "CONFLICT",
      `Confirm the description of ${names.map((n) => `"${n}"`).join(", ")} first: the models read an image only through its confirmed description.`,
    );
}
