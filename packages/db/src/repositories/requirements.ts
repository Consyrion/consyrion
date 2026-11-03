import { createHash } from "node:crypto";
import {
  assertCan,
  buildConfirmedRequirements,
  detectMeasure,
  DomainError,
  INJECTION_EXCLUSION_REASON,
  META_RULE_EXCLUSION_REASON,
  REQUIREMENT_LIMITS,
  type ExcludedRequirement,
  type RequirementCandidate,
  type RequirementSource,
  type RequirementSuspicion,
} from "@consyrion/core";
import { extractRequirements, withoutQuotes } from "@consyrion/core/engine";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { projectBrief, projectDocument, requirementList } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { getProject, lockProjectSources } from "./projects";

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
}

/**
 * What the confirmation screen shows. Without a confirmed list: every candidate as an item, suspected injections as
 * excluded. With one: the confirmed items and exclusions are carried over (with the user's edits), new statements are
 * added and marked, and items whose source disappeared are marked – the user decides, nothing is dropped silently.
 */
/** Binding wording ("muss", "spätestens", "only", a measurable limit) keeps an idea/goal sentence a requirement. */
const BINDING =
  /\b(muss|müssen|darf|dürfen|must|shall|required?|only|nur|ausschließlich|mindestens|höchstens|maximal|spätestens|at least|at most|never|niemals|keine?n?)\b/i;
function soundsBinding(text: string): boolean {
  const own = withoutQuotes(text);
  return BINDING.test(own) || detectMeasure(own) !== null;
}

export const CONTEXT_EXCLUSION_REASON = "From the idea or goal – context, not a hard requirement. Keep it if it is one.";
/**
 * #245: a document sentence without binding wording of its own – a table row, a measured value, an observation – is
 * proposed as excluded: shown, and one click keeps it. A measured value alone ("Ping 15–18 ms") is not binding; a limit
 * is ("unter 200 ms", "≥ 99,95 %", "innerhalb von vier Stunden"), and so are "muss", "only", "sind … aufzubewahren",
 * "ohne …", "revisionssicher" … outside quotation marks (external review 31.10.26: recall before precision).
 */
export const DOCUMENT_EXCLUSION_REASON =
  "From a document, without binding wording (must, only, at most, a limit …) – a description, table row or measured value. Keep it if it is a requirement.";
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
    else if (hasRequirementSource && (candidate.source.kind === "idea" || candidate.source.kind === "goal") && !soundsBinding(candidate.text))
      exclude(candidate, CONTEXT_EXCLUSION_REASON);
    else if (candidate.source.kind === "document" && !documentSoundsBinding(candidate.text)) exclude(candidate, DOCUMENT_EXCLUSION_REASON);
    else {
      items.push({ text: candidate.text, candidateKey: candidate.key, source: candidate.source, isNew: Boolean(latest), sourceGone: false });
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
    .array(z.object({ text: z.string().max(REQUIREMENT_LIMITS.maxItemChars * 2), candidateKey: z.string().max(100).nullish() }))
    .max(REQUIREMENT_LIMITS.maxItems * 2),
  excluded: z.array(z.object({ candidateKey: z.string().max(100), reason: z.string().max(2_000) })).max(REQUIREMENT_LIMITS.maxCandidates * 2),
  noHardRequirements: z.boolean().optional(),
});

/** Stores a new confirmed version. Refused when the brief or documents changed since the user's review. */
export async function confirmRequirementList(db: Database, ctx: ActorContext, projectId: string, input: z.input<typeof requirementConfirmationInput>) {
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
