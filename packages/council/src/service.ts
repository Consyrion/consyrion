import {
  architectureChange,
  assertCan,
  splitObjections,
  assertTransition,
  buildPolicy,
  COUNCIL_PHASES,
  COUNCIL_ROLES,
  DECISION_MODES,
  DomainError,
  estimateTokens,
  finalVerdictFit,
  finalVerdictFitMessage,
  MAX_CONCURRENT_SESSIONS,
  POLICY_VERSION,
  strengthSuggestion,
  voteWeightWarnings,
  type SessionStatus,
} from "@consyrion/core";
import { isCouncilCapableModel } from "@consyrion/ai";
import {
  assertCurrentRequirementList,
  assertEntitlement,
  latestRequirementList,
  lockProjectSources,
  newId,
  recordAudit,
  schema,
  type ActorContext,
  type Database,
} from "@consyrion/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { PROMPT_VERSION } from "./prompts";
import { latestStrengthCatalog } from "./model-strength";
import { validParticipation } from "./participation";
import { enqueue } from "./queue";
import {
  assertCanEvaluateSession,
  assertDecisionApprovable,
  assertDecisionRoundBinding,
  decisionStatusOf,
  GATE_VERSION,
  sessionGateVersions,
} from "./decision-format";
import { assertEngineInstalled } from "./engine-guard";

export const COUNCIL_JOB = "council.run";

const weightsInput = z.object({
  technicalQuality: z.number(),
  security: z.number(),
  maintainability: z.number(),
  operatingCost: z.number(),
  implementationSpeed: z.number(),
});

export const sessionInput = z.object({
  mode: z.enum(DECISION_MODES),
  participants: z
    .array(
      z.object({
        credentialId: z.string().min(1),
        modelId: z.string().trim().min(1).max(200),
        /** Vote weight 1–10 in the Final Verdict (#140); default: the catalog suggestion (#139). */
        voteWeight: z.number().int().min(1).max(10).optional(),
      }),
    )
    .min(2, "A council needs at least two models")
    .max(6, "At most six models per session"),
  roles: z.array(z.enum(COUNCIL_ROLES)).optional(),
  debateRounds: z.number().int().optional(),
  consensusRounds: z.number().int().optional(),
  allowHybrid: z.boolean().optional(),
  weights: weightsInput.optional(),
  tokenBudget: z.number().int().optional(),
  customRules: z.string().max(2_000).optional(),
  /** Optional explicit role → participant (index into `participants`) mapping; default is round-robin. */
  roleAssignments: z.array(z.object({ role: z.enum(COUNCIL_ROLES), participantIndex: z.number().int().min(0) })).optional(),
  /** Required when the preview's upper bound exceeds the budget: the user accepted that phases may be shortened (#148). */
  confirmBudget: z.boolean().optional(),
});
export type SessionInput = z.input<typeof sessionInput>;

function parse<T extends z.ZodType>(schemaDef: T, input: unknown): z.output<T> {
  const parsed = schemaDef.safeParse(input);
  if (!parsed.success) {
    // Name the fields, so an API or MCP client can correct its call (QA 07.11.26: "Invalid session configuration" alone).
    const fields = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).slice(0, 5);
    throw new DomainError("VALIDATION", `Invalid session configuration – ${fields.join("; ")}`, z.flattenError(parsed.error));
  }
  return parsed.data;
}

/** Cost preview shown before starting: calls per phase and an upper bound of tokens. */
/** Media models are not offered in the UI; a manually entered or API-supplied id is refused here too (#118). */
function assertCouncilModels(participants: ReadonlyArray<{ modelId: string }>) {
  const media = participants.find((p) => !isCouncilCapableModel(p.modelId));
  if (media) throw new DomainError("VALIDATION", `${media.modelId} is an image, video or audio model and cannot take part in a council`);
}

/**
 * Every model must be one the selected key offers (#144): an invented id, a model of another provider or one the key
 * may not use is refused before any provider is called. Keys whose models cannot be listed are not checked. Returns
 * the participants with the provider's own spelling of each id.
 */
async function assertModelsAvailable<P extends { credentialId: string; modelId: string }>(
  participants: P[],
  credentials: ReadonlyArray<{ id: string; provider: string }>,
  catalog: ModelCatalog,
): Promise<P[]> {
  const lists = new Map<string, Map<string, string> | null>();
  for (const id of new Set(participants.map((p) => p.credentialId))) {
    const models = await catalog(id);
    lists.set(id, models && models.length > 0 ? new Map(models.map((m) => [m.toLowerCase(), m])) : null);
  }
  const unknown = participants.filter((p) => {
    const list = lists.get(p.credentialId);
    return list ? !list.has(p.modelId.toLowerCase()) : false;
  });
  if (unknown.length > 0) {
    const named = unknown.map((p) => `${p.modelId} (${credentials.find((c) => c.id === p.credentialId)?.provider ?? "unknown"} key)`).join(", ");
    throw new DomainError("VALIDATION", `Not available for the selected API key: ${named}. Choose a model from the list of that key.`);
  }
  return participants.map((p) => ({ ...p, modelId: lists.get(p.credentialId)?.get(p.modelId.toLowerCase()) ?? p.modelId }));
}

export async function previewSession(db: Database, ctx: ActorContext, projectId: string, input: SessionInput) {
  assertCan(ctx.role, "decision:run");
  const data = parse(sessionInput, input);
  assertCouncilModels(data.participants);
  const { policy, errors } = buildPolicy(data.mode, data);
  if (errors.length) throw new DomainError("VALIDATION", errors.join("; "));
  const brief = await latestBrief(db, ctx, projectId);
  const preview = await costPreview(db, ctx, projectId, data, policy, brief);
  // The same plan gate as the start (#173), reported instead of thrown so the estimate stays visible and the UI can
  // disable the start button: models per session and councils per month.
  const planLimit = await assertEntitlement(db, ctx.organizationId, "session", { participants: data.participants.length }).then(
    () => null,
    (error: unknown) => {
      if (error instanceof DomainError && error.code === "FORBIDDEN") return error.message;
      throw error;
    },
  );
  // #228: does every evaluator's Final Verdict fit into one call? Counted on the latest confirmed list (the start
  // checks the current one again). A refusal is reported, not thrown, so the screen can disable the start.
  const requirementCount = (await latestRequirementList(db, ctx, projectId))?.items.length ?? 0;
  const fit = finalVerdictFit(data.participants.length, requirementCount);
  const finalVerdictSize = { ...fit, message: finalVerdictFitMessage(fit, data.participants.length, requirementCount) };
  const voteWeights = await voteWeightsFor(db, ctx, data.participants);
  // Warnings only (#170): a dominant share or a far-off weight is shown before the start, never silently capped.
  const warnings = voteWeightWarnings(
    data.participants.map((p, i) => ({ model: p.modelId, weight: voteWeights[i]!.weight, suggestion: voteWeights[i]!.suggestion })),
  );
  return { policy, ...preview, planLimit, finalVerdictSize, voteWeights, voteWeightWarnings: warnings };
}

/**
 * Vote weight per participant (#140): the user's value, otherwise the catalog suggestion (#139). Returned with the
 * suggestion so the screen and the stored run show both.
 */
async function voteWeightsFor(db: Database, ctx: ActorContext, participants: ReadonlyArray<{ credentialId: string; modelId: string; voteWeight?: number }>) {
  const catalog = await latestStrengthCatalog(db);
  const credentials = await db
    .select({ id: schema.aiProviderCredential.id, provider: schema.aiProviderCredential.provider })
    .from(schema.aiProviderCredential)
    .where(
      and(
        inArray(schema.aiProviderCredential.id, [...new Set(participants.map((p) => p.credentialId))]),
        eq(schema.aiProviderCredential.organizationId, ctx.organizationId),
      ),
    );
  return participants.map((p) => {
    const suggestion = strengthSuggestion(credentials.find((c) => c.id === p.credentialId)?.provider ?? "", p.modelId, catalog);
    return { weight: p.voteWeight ?? suggestion.tier, suggestion };
  });
}

/** Calls with a recorded usage that the typical-consumption estimate is based on, at most. */
const TYPICAL_SAMPLE = 500;
/** Fewer recorded calls than this give no typical estimate – only the upper bound is shown. */
const TYPICAL_MIN_SAMPLE = 20;

/**
 * Upper bound and, where this workspace has enough history, the typical consumption (#148): the median tokens per
 * successful call of its latest councils × the calls of this configuration. Measured, never invented.
 */
async function costPreview(
  db: Database,
  ctx: ActorContext,
  projectId: string,
  data: z.output<typeof sessionInput>,
  policy: ReturnType<typeof buildPolicy>["policy"],
  brief: Awaited<ReturnType<typeof latestBrief>>,
) {
  const documents = await db
    .select({ size: schema.projectDocument.sizeBytes })
    .from(schema.projectDocument)
    .where(and(eq(schema.projectDocument.projectId, projectId), eq(schema.projectDocument.organizationId, ctx.organizationId)));
  const chars = brief.idea.length + brief.goal.length + brief.requirements.length + documents.reduce((n, d) => n + d.size, 0);
  const credentialIds = [...new Set(data.participants.map((p) => p.credentialId))];
  const credentials = await db
    .select({ id: schema.aiProviderCredential.id, provider: schema.aiProviderCredential.provider })
    .from(schema.aiProviderCredential)
    .where(and(inArray(schema.aiProviderCredential.id, credentialIds), eq(schema.aiProviderCredential.organizationId, ctx.organizationId)));
  const providers = data.participants.map((p) => credentials.find((c) => c.id === p.credentialId)?.provider ?? "");
  const estimate = estimateTokens(policy, data.participants.length, chars, providers);
  const recent = await db
    .select({ tokens: sql<number>`(${schema.usageRecord.inputTokens} + ${schema.usageRecord.outputTokens})::int` })
    .from(schema.usageRecord)
    .where(and(eq(schema.usageRecord.organizationId, ctx.organizationId), eq(schema.usageRecord.outcome, "ok")))
    .orderBy(desc(schema.usageRecord.createdAt))
    .limit(TYPICAL_SAMPLE);
  let typical: { tokens: number; basedOnCalls: number } | null = null;
  if (recent.length >= TYPICAL_MIN_SAMPLE) {
    const sorted = recent.map((r) => Number(r.tokens)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    typical = { tokens: Math.min(estimate.upperBound, median * estimate.calls), basedOnCalls: recent.length };
  }
  return { documents: documents.length, estimate: { ...estimate, typical }, modelWarnings: await modelWarnings(db, ctx, data.participants, providers) };
}

/** Recent calls of a model in this workspace that the preview warning is based on (#175). */
const WARNING_WINDOW_DAYS = 14;
const WARNING_MIN_CALLS = 6;

/**
 * Models that failed often in this workspace's recent councils (#175: Gemini Flash Latest timed out in run after run),
 * from the workspace's own usage rows – never a hardcoded list. With three models one failing provider plus one
 * broken answer is enough to lose the whole council, so the start screen says so before the run.
 */
async function modelWarnings(
  db: Database,
  ctx: ActorContext,
  participants: ReadonlyArray<{ modelId: string }>,
  providers: ReadonlyArray<string>,
): Promise<string[]> {
  const models = [...new Set(participants.map((p) => p.modelId))];
  if (models.length === 0) return [];
  const since = new Date(Date.now() - WARNING_WINDOW_DAYS * 24 * 60 * 60_000);
  const rows = await db
    .select({
      modelId: schema.usageRecord.modelId,
      provider: schema.usageRecord.provider,
      outcome: schema.usageRecord.outcome,
      errorKind: schema.usageRecord.errorKind,
      calls: sql<number>`count(*)::int`,
    })
    .from(schema.usageRecord)
    .where(
      and(
        eq(schema.usageRecord.organizationId, ctx.organizationId),
        inArray(schema.usageRecord.modelId, models),
        isNotNull(schema.usageRecord.sessionId),
        gte(schema.usageRecord.createdAt, since),
      ),
    )
    .groupBy(schema.usageRecord.modelId, schema.usageRecord.provider, schema.usageRecord.outcome, schema.usageRecord.errorKind);
  const warnings: string[] = [];
  participants.forEach((participant, index) => {
    const own = rows.filter((r) => r.modelId === participant.modelId && r.provider === providers[index]);
    const total = own.reduce((n, r) => n + Number(r.calls), 0);
    const failedRows = own.filter((r) => r.outcome !== "ok");
    const failed = failedRows.reduce((n, r) => n + Number(r.calls), 0);
    if (total < WARNING_MIN_CALLS || failed * 3 < total) return;
    const top = [...failedRows].sort((a, b) => Number(b.calls) - Number(a.calls))[0];
    const kind = (top?.errorKind ?? top?.outcome ?? "error").replaceAll("_", " ");
    const text = `${participant.modelId}: ${failed} of ${total} calls in this workspace's councils of the last ${WARNING_WINDOW_DAYS} days failed (mostly ${kind})${
      participants.length <= 3 ? " – with three or fewer models, losing it and one more answer can end the council early" : ""
    }`;
    if (!warnings.includes(text)) warnings.push(text);
  });
  return warnings;
}

async function latestBrief(db: Database, ctx: ActorContext, projectId: string) {
  const [proj] = await db
    .select()
    .from(schema.project)
    .where(and(eq(schema.project.id, projectId), eq(schema.project.organizationId, ctx.organizationId)));
  if (!proj) throw new DomainError("NOT_FOUND", "Project not found");
  if (proj.status === "archived") throw new DomainError("CONFLICT", "Project is archived");
  const [brief] = await db
    .select()
    .from(schema.projectBrief)
    .where(eq(schema.projectBrief.projectId, projectId))
    .orderBy(desc(schema.projectBrief.version))
    .limit(1);
  if (!brief) throw new DomainError("CONFLICT", "Project has no brief");
  return brief;
}

/**
 * Live model ids a stored key may use (#144), or null when they cannot be listed right now (provider down, no models
 * endpoint). Injected by the app, which can decrypt the key; tests pass a fixed list.
 */
export type ModelCatalog = (credentialId: string) => Promise<string[] | null>;

/**
 * What a budget confirmation accepts (#172): the API error and the start screen say the same. When the budget runs
 * short the last debate phases are dropped – without the Consensus Round no proposal is revised.
 */
export const BUDGET_SHORTENING_NOTE =
  "If the budget runs short, debate phases are shortened to keep enough for the Final Verdict: Minority Review and Consensus Round may be dropped, and then no proposal is revised – the verdict judges the first versions and is marked as shortened.";

export async function createSession(db: Database, ctx: ActorContext, projectId: string, input: SessionInput, catalog?: ModelCatalog) {
  assertCan(ctx.role, "decision:run");
  assertEngineInstalled();
  const data = parse(sessionInput, input);
  assertCouncilModels(data.participants);
  const { policy, errors } = buildPolicy(data.mode, data);
  if (errors.length) throw new DomainError("VALIDATION", errors.join("; "));
  const brief = await latestBrief(db, ctx, projectId);
  // Only on a requirement list confirmed for exactly this brief version and these documents (#190).
  const requirements = await assertCurrentRequirementList(db, ctx, projectId);
  if (requirements.state.briefId !== brief.id) throw new DomainError("CONFLICT", "The brief changed. Review and confirm the requirements again.");
  // #228: refused before any model is paid when the Final Verdict cannot fit into one call per evaluator.
  const fit = finalVerdictFit(data.participants.length, requirements.list.items.length);
  if (!fit.fits) throw new DomainError("VALIDATION", finalVerdictFitMessage(fit, data.participants.length, requirements.list.items.length)!);
  await assertEntitlement(db, ctx.organizationId, "session", { participants: data.participants.length });
  const { estimate } = await costPreview(db, ctx, projectId, data, policy, brief);
  if (!estimate.withinBudget && !data.confirmBudget)
    throw new DomainError(
      "VALIDATION",
      `The upper bound of ${estimate.upperBound.toLocaleString("en-US")} tokens exceeds the budget of ${policy.tokenBudget.toLocaleString("en-US")}. ${BUDGET_SHORTENING_NOTE} Confirm this, or raise the budget.`,
    );
  const [active] = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(schema.councilSession)
    .where(and(eq(schema.councilSession.organizationId, ctx.organizationId), inArray(schema.councilSession.status, ["queued", "running", "cancel_requested"])));
  if ((active?.running ?? 0) >= MAX_CONCURRENT_SESSIONS)
    throw new DomainError(
      "CONFLICT",
      `At most ${MAX_CONCURRENT_SESSIONS} councils can run at the same time in a workspace. Wait for one to finish or stop it.`,
    );

  // Credentials must belong to this organization; the provider comes from the stored credential.
  const credentialIds = [...new Set(data.participants.map((p) => p.credentialId))];
  const credentials = await db
    .select({ id: schema.aiProviderCredential.id, provider: schema.aiProviderCredential.provider })
    .from(schema.aiProviderCredential)
    .where(and(inArray(schema.aiProviderCredential.id, credentialIds), eq(schema.aiProviderCredential.organizationId, ctx.organizationId)));
  if (credentials.length !== credentialIds.length) throw new DomainError("VALIDATION", "Unknown API key selected");
  if (data.roleAssignments) {
    const assigned = new Set(data.roleAssignments.map((a) => a.role));
    const outside = data.roleAssignments.find((a) => !policy.roles.includes(a.role));
    if (outside) throw new DomainError("VALIDATION", `Role ${outside.role} is assigned but not part of this council's roles`);
    if (data.roleAssignments.some((a) => a.participantIndex >= data.participants.length))
      throw new DomainError("VALIDATION", "Role assigned to an unknown model");
    if (policy.roles.some((role) => !assigned.has(role)) || assigned.size !== data.roleAssignments.length)
      throw new DomainError("VALIDATION", "Every active role needs exactly one model");
  }
  // Model ids are compared case-insensitively: " GPT-4o-mini " and "gpt-4o-mini" are the same model (#144).
  // #249 review: the same model through a second key is no second independent evaluator, so it counts once – per
  // provider, not per key.
  const providerOf = new Map(credentials.map((c) => [c.id, c.provider]));
  const keys = data.participants.map((p) => `${providerOf.get(p.credentialId)}:${p.modelId.trim().toLowerCase()}`);
  if (new Set(keys).size !== keys.length)
    throw new DomainError("VALIDATION", "Each model may join a council only once – also with a second API key, since it would not be an independent evaluator");
  if (catalog) data.participants = await assertModelsAvailable(data.participants, credentials, catalog);

  // Fixed at the start: the weights and their suggestions cannot change during the run (#140).
  const weights = await voteWeightsFor(db, ctx, data.participants);
  const sessionId = newId("ses");
  await db.transaction(async (tx) => {
    // Checked again under the project lock (#181 review): brief, document and requirement changes take the same lock,
    // so a change either is seen here (refused) or waits until this session is stored.
    await lockProjectSources(tx, projectId);
    const current = await assertCurrentRequirementList(tx, ctx, projectId);
    if (current.list.id !== requirements.list.id || current.state.briefId !== requirements.state.briefId)
      throw new DomainError("CONFLICT", "The brief, the documents or the requirement list changed while starting. Review and confirm the requirements again.");
    await tx.insert(schema.councilSession).values({
      id: sessionId,
      organizationId: ctx.organizationId,
      projectId,
      briefId: brief.id,
      mode: data.mode,
      policy: policy as unknown as Record<string, unknown>,
      policyVersion: POLICY_VERSION,
      promptVersion: PROMPT_VERSION,
      tokenBudget: policy.tokenBudget,
      // The documents of the confirmed source state – the same set the list was confirmed against.
      documentIds: requirements.state.documents.map((d) => d.id),
      requirementListId: requirements.list.id,
      gateVersion: GATE_VERSION,
      createdById: ctx.userId,
    });
    const participantIds: string[] = [];
    for (const [position, p] of data.participants.entries()) {
      const weight = weights[position]!;
      const id = newId("par");
      participantIds.push(id);
      await tx.insert(schema.councilParticipant).values({
        id,
        organizationId: ctx.organizationId,
        sessionId,
        provider: credentials.find((c) => c.id === p.credentialId)!.provider,
        modelId: p.modelId,
        credentialId: p.credentialId,
        position,
        voteWeight: weight.weight,
        voteWeightSuggestion: weight.suggestion as unknown as Record<string, unknown>,
      });
    }
    // Roles are spread round-robin so every model contributes perspectives.
    for (const [index, role] of policy.roles.entries()) {
      const explicit = data.roleAssignments?.find((a) => a.role === role)?.participantIndex;
      await tx.insert(schema.councilRoleAssignment).values({
        id: newId("rol"),
        organizationId: ctx.organizationId,
        sessionId,
        role,
        participantId: participantIds[explicit ?? index % participantIds.length]!,
      });
    }
    for (const phase of COUNCIL_PHASES) {
      await tx.insert(schema.workflowStage).values({ id: newId("stg"), organizationId: ctx.organizationId, sessionId, phase });
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "council.started",
      targetType: "council_session",
      targetId: sessionId,
      metadata: { mode: data.mode, participants: data.participants.length, requirementListVersion: requirements.list.version },
    });
  });
  await enqueue(db, COUNCIL_JOB, { sessionId }, `${COUNCIL_JOB}:${sessionId}:0`, ctx.organizationId);
  return { id: sessionId };
}

async function loadSession(db: Database, ctx: ActorContext, sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.councilSession)
    .where(and(eq(schema.councilSession.id, sessionId), eq(schema.councilSession.organizationId, ctx.organizationId)));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  return session;
}

export async function listSessions(db: Database, ctx: ActorContext, projectId?: string) {
  assertCan(ctx.role, "project:read");
  const where = projectId
    ? and(eq(schema.councilSession.organizationId, ctx.organizationId), eq(schema.councilSession.projectId, projectId))
    : eq(schema.councilSession.organizationId, ctx.organizationId);
  return db
    .select({
      id: schema.councilSession.id,
      projectId: schema.councilSession.projectId,
      projectName: schema.project.name,
      mode: schema.councilSession.mode,
      status: schema.councilSession.status,
      currentPhase: schema.councilSession.currentPhase,
      tokensUsed: schema.councilSession.tokensUsed,
      tokenBudget: schema.councilSession.tokenBudget,
      createdAt: schema.councilSession.createdAt,
    })
    .from(schema.councilSession)
    .innerJoin(schema.project, eq(schema.project.id, schema.councilSession.projectId))
    .where(where)
    .orderBy(desc(schema.councilSession.createdAt));
}

/** Participants (provider, model, status) of several sessions of this workspace, for overview lists. */
export async function listSessionParticipants(db: Database, ctx: ActorContext, sessionIds: string[]) {
  assertCan(ctx.role, "project:read");
  if (sessionIds.length === 0) return [];
  return db
    .select({
      sessionId: schema.councilParticipant.sessionId,
      provider: schema.councilParticipant.provider,
      modelId: schema.councilParticipant.modelId,
      status: schema.councilParticipant.status,
    })
    .from(schema.councilParticipant)
    .where(and(inArray(schema.councilParticipant.sessionId, sessionIds), eq(schema.councilParticipant.organizationId, ctx.organizationId)))
    .orderBy(asc(schema.councilParticipant.position));
}

/**
 * Full read model of a session. Server-side rules: proposal texts are only returned after the
 * reveal, and which model wrote which proposal stays hidden until a verdict exists.
 */
/** Architecture change of a revised proposal against the other proposals' originals (#150), null when never revised. */
function architectureChangeOf(
  proposalId: string,
  proposals: ReadonlyArray<{ id: string; label: string | null }>,
  revisions: ReadonlyArray<{ proposalId: string; content: unknown }>,
) {
  const own = revisions.filter((r) => r.proposalId === proposalId);
  if (own.length < 2) return null;
  const others = proposals
    .filter((p) => p.id !== proposalId)
    .map((p) => ({ label: p.label ?? "?", content: revisions.find((r) => r.proposalId === p.id)?.content }));
  return architectureChange(own[0]!.content, own.at(-1)!.content, others);
}

/**
 * Marks objections raised against an earlier revision whose subject is gone (#150) – computed here so the rule stays
 * out of the browser (#189). null: the objection still applies to the current revision.
 */
function withMootness<O extends { id: string; proposalId: string; claim: string; createdAt: Date }>(
  objections: ReadonlyArray<O>,
  revisions: ReadonlyArray<{ proposalId: string; version: number; content: unknown; createdAt: Date }>,
) {
  const moot = new Map<string, { againstVersion: number; currentVersion: number }>();
  for (const proposalId of new Set(objections.map((o) => o.proposalId))) {
    const split = splitObjections(
      objections.filter((o) => o.proposalId === proposalId),
      revisions.filter((r) => r.proposalId === proposalId),
    );
    for (const o of split.moot) moot.set(o.id, { againstVersion: o.againstVersion, currentVersion: o.currentVersion });
  }
  return objections.map((o) => ({ ...o, moot: moot.get(o.id) ?? null }));
}

export async function getSessionView(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "project:read");
  const session = await loadSession(db, ctx, sessionId);
  const [participants, roles, stages, proposals, messages, objections, scores, votes, decisions, approvals, usage, minority, consensus, brief, project] =
    await Promise.all([
      db.select().from(schema.councilParticipant).where(eq(schema.councilParticipant.sessionId, sessionId)).orderBy(asc(schema.councilParticipant.position)),
      db.select().from(schema.councilRoleAssignment).where(eq(schema.councilRoleAssignment.sessionId, sessionId)),
      db.select().from(schema.workflowStage).where(eq(schema.workflowStage.sessionId, sessionId)),
      db.select().from(schema.proposal).where(eq(schema.proposal.sessionId, sessionId)).orderBy(asc(schema.proposal.label)),
      db.select().from(schema.debateMessage).where(eq(schema.debateMessage.sessionId, sessionId)).orderBy(asc(schema.debateMessage.createdAt)),
      db.select().from(schema.minorityObjection).where(eq(schema.minorityObjection.sessionId, sessionId)).orderBy(asc(schema.minorityObjection.createdAt)),
      db.select().from(schema.evaluationScore).where(eq(schema.evaluationScore.sessionId, sessionId)),
      db.select().from(schema.vote).where(eq(schema.vote.sessionId, sessionId)),
      db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, sessionId)).orderBy(desc(schema.finalDecision.createdAt)),
      db.select().from(schema.humanApproval).where(eq(schema.humanApproval.sessionId, sessionId)).orderBy(asc(schema.humanApproval.createdAt)),
      db
        .select({
          participantId: schema.usageRecord.participantId,
          phase: schema.usageRecord.phase,
          outcome: schema.usageRecord.outcome,
          calls: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${schema.usageRecord.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${schema.usageRecord.outputTokens}), 0)::int`,
        })
        .from(schema.usageRecord)
        .where(eq(schema.usageRecord.sessionId, sessionId))
        .groupBy(schema.usageRecord.participantId, schema.usageRecord.phase, schema.usageRecord.outcome),
      db.select().from(schema.minorityReview).where(eq(schema.minorityReview.sessionId, sessionId)),
      db.select().from(schema.consensusResult).where(eq(schema.consensusResult.sessionId, sessionId)),
      db.select().from(schema.projectBrief).where(eq(schema.projectBrief.id, session.briefId)),
      db
        .select({ id: schema.project.id, name: schema.project.name, deliveryDefault: schema.project.deliveryDefault })
        .from(schema.project)
        .where(eq(schema.project.id, session.projectId)),
    ]);
  // The confirmed requirement list this run is bound to (#190); historic versions stay readable.
  const [requirementList] = session.requirementListId
    ? await db.select().from(schema.requirementList).where(eq(schema.requirementList.id, session.requirementListId))
    : [];
  const revealed = proposals.filter((p) => p.revealedAt);
  // Raw requirement checks of gate version 2 (#181): all of them, also those that did not count, for the evidence view.
  const requirementChecks = revealed.length
    ? await db
        .select({
          id: schema.requirementCheck.id,
          evaluatorParticipantId: schema.requirementCheck.evaluatorParticipantId,
          proposalId: schema.requirementCheck.proposalId,
          requirementId: schema.requirementCheck.requirementId,
          status: schema.requirementCheck.status,
          allPartsMet: schema.requirementCheck.allPartsMet,
          evidence: schema.requirementCheck.evidence,
          estimateLow: schema.requirementCheck.estimateLow,
          estimateHigh: schema.requirementCheck.estimateHigh,
          valid: schema.requirementCheck.valid,
          invalidReason: schema.requirementCheck.invalidReason,
        })
        .from(schema.requirementCheck)
        .where(eq(schema.requirementCheck.sessionId, sessionId))
        .orderBy(asc(schema.requirementCheck.createdAt), asc(schema.requirementCheck.id))
    : [];
  const revisions = revealed.length
    ? await db
        .select()
        .from(schema.proposalRevision)
        .where(
          inArray(
            schema.proposalRevision.proposalId,
            revealed.map((p) => p.id),
          ),
        )
        .orderBy(asc(schema.proposalRevision.version))
    : [];
  const decision = decisions.find((d) => !d.supersededAt) ?? null;
  const authorsVisible = Boolean(decision);
  // Failed calls per model with the kind of the last failure (#175), so the Council Room can say why a model stalls.
  const failureRows = await db
    .select({
      participantId: schema.usageRecord.participantId,
      phase: schema.usageRecord.phase,
      outcome: schema.usageRecord.outcome,
      errorKind: schema.usageRecord.errorKind,
      httpStatus: schema.usageRecord.httpStatus,
      createdAt: schema.usageRecord.createdAt,
    })
    .from(schema.usageRecord)
    .where(and(eq(schema.usageRecord.sessionId, sessionId), sql`${schema.usageRecord.outcome} <> 'ok'`))
    .orderBy(asc(schema.usageRecord.createdAt));
  const callFailures = participants.flatMap((p) => {
    const rows = failureRows.filter((r) => r.participantId === p.id);
    const last = rows.at(-1);
    if (!last) return [];
    return [
      {
        participantId: p.id,
        failed: rows.length,
        failedInCurrentPhase: rows.filter((r) => r.phase === session.currentPhase).length,
        // Rows from before #175 have no kind; their outcome is the best available description.
        lastErrorKind: last.errorKind ?? last.outcome,
        lastHttpStatus: last.httpStatus,
        lastPhase: last.phase,
        lastAt: last.createdAt,
      },
    ];
  });
  return {
    session,
    project: project[0]!,
    brief: brief[0]!,
    requirementList: requirementList
      ? {
          id: requirementList.id,
          version: requirementList.version,
          items: requirementList.items,
          excluded: requirementList.excluded,
          noHardRequirements: requirementList.noHardRequirements,
          confirmedAt: requirementList.confirmedAt,
        }
      : null,
    requirementChecks,
    participants: participants.map((p) => ({
      id: p.id,
      provider: p.provider,
      modelId: p.modelId,
      position: p.position,
      status: p.status,
      failureReason: p.failureReason,
      voteWeight: p.voteWeight,
      voteWeightSuggestion: p.voteWeightSuggestion,
    })),
    roles,
    stages: COUNCIL_PHASES.map((phase) => stages.find((s) => s.phase === phase)!).filter(Boolean),
    submittedCount: proposals.length,
    proposals: revealed.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      authorParticipantId: authorsVisible ? p.authorParticipantId : null,
      revisions: revisions.filter((r) => r.proposalId === p.id),
      // Computed here, not in the browser (#189): did the latest revision replace the original solution (#150)?
      architectureChange: architectureChangeOf(p.id, revealed, revisions),
    })),
    messages,
    objections: withMootness(objections, revisions),
    scores,
    votes,
    decision,
    // Computed on the server (#181, stage 1): clients only display it, they never re-check the format themselves.
    decisionStatus: decision
      ? decisionStatusOf(
          decision,
          revealed.map((p) => p.id),
        )
      : null,
    previousDecisions: decisions.filter((d) => d.supersededAt),
    approvals,
    usage,
    callFailures,
    // Valid participation rate (#182), derived from the usage rows above.
    participation: validParticipation(participants, usage),
    minorityReview: minority[0] ?? null,
    consensus: consensus[0] ?? null,
    queue: session.status === "queued" ? await queuePosition(db, sessionId) : null,
  };
}

/**
 * Why a queued session waits (#149): how many due jobs are ahead of it and how many run right now. Counts only –
 * nothing about other workspaces' jobs is revealed.
 */
async function queuePosition(db: Database, sessionId: string) {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM job a WHERE a.status = 'queued' AND a.run_at <= now() AND a.run_at < mine.run_at)::int AS ahead,
      (SELECT count(*) FROM job r WHERE r.status = 'running' AND r.locked_until >= now())::int AS running,
      (SELECT count(*) FROM job w WHERE w.status = 'running' AND w.locked_until >= now() AND w.organization_id = mine.organization_id)::int AS "runningInWorkspace"
    FROM job mine
    WHERE mine.kind = ${COUNCIL_JOB} AND mine.status = 'queued' AND mine.payload->>'sessionId' = ${sessionId}
    ORDER BY mine.run_at
    LIMIT 1`);
  const rows =
    (result as unknown as { rows?: Array<{ ahead: number; running: number; runningInWorkspace: number }> }).rows ??
    (result as unknown as Array<{ ahead: number; running: number; runningInWorkspace: number }>);
  const row = rows[0];
  return row ? { ahead: Number(row.ahead), running: Number(row.running), runningInWorkspace: Number(row.runningInWorkspace) } : null;
}
export type SessionView = Awaited<ReturnType<typeof getSessionView>>;

export async function cancelSession(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "decision:run");
  const session = await loadSession(db, ctx, sessionId);
  const status = session.status as SessionStatus;
  if (status === "queued") {
    assertTransition(status, "cancelled");
    await db.update(schema.councilSession).set({ status: "cancelled", finishedAt: new Date() }).where(eq(schema.councilSession.id, sessionId));
  } else {
    assertTransition(status, "cancel_requested");
    await db.update(schema.councilSession).set({ status: "cancel_requested" }).where(eq(schema.councilSession.id, sessionId));
  }
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "council.cancel_requested",
    targetType: "council_session",
    targetId: sessionId,
  });
}

export const approvalInput = z.object({
  action: z.enum(["approve", "reject", "request_more_debate", "request_changes", "select_alternative", "repeat_evaluation"]),
  comment: z.string().trim().max(5_000).default(""),
  selectedProposalId: z.string().optional(),
});

/**
 * A release that only knows older gate versions must not start a re-evaluation of a council whose verdict was
 * computed with a newer one (#181, stage 1): checked over all decisions of the session, also superseded ones.
 */
async function assertSessionEvaluable(db: Database, sessionId: string) {
  assertCanEvaluateSession(await sessionGateVersions(db, sessionId));
}

/**
 * A verdict only counts for the requirement list its session runs on (#190): a verdict of another list version – or
 * one without a list in a session that has one – can neither be approved nor lead to a build.
 */
export function assertDecisionOnSessionList(session: { requirementListId: string | null }, decision: { requirementListId: string | null }) {
  if ((session.requirementListId ?? null) !== (decision.requirementListId ?? null))
    throw new DomainError("CONFLICT", "This verdict was reached on a different requirement list version than the session's. It can no longer be approved.");
}

const PHASES_AFTER_DEBATE = ["twelve_minds_council", "minority_review", "consensus_round", "final_verdict"] as const;

/**
 * Human gate. Only owners/admins may decide; security-blocked proposals cannot be approved, also not
 * via "select alternative". Nothing here starts development – that requires an approved session (M4).
 */
export async function submitApproval(db: Database, ctx: ActorContext, sessionId: string, input: z.input<typeof approvalInput>) {
  assertCan(ctx.role, "decision:approve");
  const data = parse(approvalInput, input);
  const session = await loadSession(db, ctx, sessionId);
  if (session.status !== "awaiting_approval") throw new DomainError("CONFLICT", "The session is not waiting for a decision");
  const [decision] = await db
    .select()
    .from(schema.finalDecision)
    .where(and(eq(schema.finalDecision.sessionId, sessionId), isNull(schema.finalDecision.supersededAt)));
  if (!decision) throw new DomainError("CONFLICT", "No verdict available");
  assertDecisionOnSessionList(session, decision);
  const objections = await db.select().from(schema.minorityObjection).where(eq(schema.minorityObjection.sessionId, sessionId));
  const isBlocked = (proposalId: string) =>
    objections.some((o) => o.proposalId === proposalId && o.blocking && ["open", "accepted", "unresolved"].includes(o.status));

  let nextStatus: SessionStatus;
  let selected: string | null = null;
  switch (data.action) {
    case "approve":
      if (decision.outcome !== "recommended" || !decision.recommendedProposalId)
        throw new DomainError("CONFLICT", "There is no recommended solution to approve; select an alternative or request more debate");
      if (isBlocked(decision.recommendedProposalId))
        throw new DomainError("CONFLICT", "The recommendation is blocked by an unresolved critical security objection");
      // Format version first (#181, stage 1): unknown versions, outcomes or inconsistent matrices are never approvable.
      assertDecisionApprovable(decision, decision.recommendedProposalId);
      await assertDecisionRoundBinding(db, sessionId, decision);
      selected = decision.recommendedProposalId;
      nextStatus = "approved";
      break;
    case "select_alternative": {
      if (!data.selectedProposalId) throw new DomainError("VALIDATION", "Select a proposal");
      const [p] = await db
        .select()
        .from(schema.proposal)
        .where(and(eq(schema.proposal.id, data.selectedProposalId), eq(schema.proposal.sessionId, sessionId)));
      if (!p) throw new DomainError("VALIDATION", "Unknown proposal");
      if (isBlocked(p.id)) throw new DomainError("CONFLICT", "This proposal is blocked by an unresolved critical security objection");
      // A human may overrule scores, not facts: a finding that the requirements conflict cannot be built (#121).
      // Also checks the decision format version and its consistency (#181, stage 1).
      assertDecisionApprovable(decision, p.id);
      await assertDecisionRoundBinding(db, sessionId, decision);
      if (!data.comment) throw new DomainError("VALIDATION", "Explain why you choose an alternative");
      selected = p.id;
      nextStatus = "approved";
      break;
    }
    case "reject":
      nextStatus = "rejected";
      break;
    case "request_changes":
      if (!data.comment) throw new DomainError("VALIDATION", "Describe the requested changes");
      nextStatus = "changes_requested";
      break;
    case "repeat_evaluation": {
      await assertSessionEvaluable(db, sessionId);
      // Only the evaluators without usable scores are asked again; stored scores and votes stay (#145).
      const participants = await db
        .select()
        .from(schema.councilParticipant)
        .where(and(eq(schema.councilParticipant.sessionId, sessionId), eq(schema.councilParticipant.status, "active")));
      const voted = new Set((await db.select().from(schema.vote).where(eq(schema.vote.sessionId, sessionId))).map((v) => v.evaluatorParticipantId));
      if (session.gateVersion >= 2) {
        // S1 (#181): only completely missing evaluations of the frozen round, by models that can still answer. A
        // missing single requirement check stays open; a new evaluation of everything needs a new council.
        const [round] = await db
          .select()
          .from(schema.evaluationRound)
          .where(and(eq(schema.evaluationRound.sessionId, sessionId), eq(schema.evaluationRound.round, 1)));
        const expected = new Set(round?.proposals.flatMap((p) => p.expectedEvaluatorIds) ?? []);
        if (!participants.some((p) => expected.has(p.id) && !voted.has(p.id)))
          throw new DomainError(
            "CONFLICT",
            "No expected evaluator of this round is missing and still available. Missing single requirement checks stay open; to evaluate again, change the brief or requirements and start a new council.",
          );
      } else if (participants.every((p) => voted.has(p.id))) throw new DomainError("CONFLICT", "Every active model has already delivered its evaluation");
      nextStatus = "queued";
      break;
    }
    case "request_more_debate": {
      // S1 (#181): an extra debate would discard the stored evaluation of the frozen round. Refused before any change;
      // the way forward is a new council on a changed brief or requirement list.
      if (session.gateVersion >= 2)
        throw new DomainError(
          "CONFLICT",
          "More debate is not available for this verdict: it would discard the stored requirement checks. Change the brief or the requirements, confirm them and start a new council.",
        );
      await assertSessionEvaluable(db, sessionId);
      const policy = session.policy as { debateRounds: number; maxExtraRounds: number };
      if (session.debateRoundsRun >= policy.debateRounds + policy.maxExtraRounds)
        throw new DomainError("CONFLICT", "The maximum number of extra debate rounds has been reached");
      nextStatus = "queued";
      break;
    }
  }
  assertTransition(session.status as SessionStatus, nextStatus);

  await db.transaction(async (tx) => {
    await tx.insert(schema.humanApproval).values({
      id: newId("apr"),
      organizationId: ctx.organizationId,
      sessionId,
      decisionId: decision.id,
      action: data.action,
      selectedProposalId: selected,
      requirementListId: decision.requirementListId,
      comment: data.comment,
      userId: ctx.userId,
    });
    await tx
      .update(schema.councilSession)
      .set({ status: nextStatus, finishedAt: nextStatus === "queued" ? null : new Date() })
      .where(eq(schema.councilSession.id, sessionId));
    if (data.action === "request_more_debate") {
      await tx
        .update(schema.workflowStage)
        .set({ status: "pending", completedAt: null, error: null })
        .where(and(eq(schema.workflowStage.sessionId, sessionId), inArray(schema.workflowStage.phase, [...PHASES_AFTER_DEBATE])));
      // New evaluation: earlier scores and votes stay stored but belong to the superseded verdict.
      await tx.delete(schema.vote).where(eq(schema.vote.sessionId, sessionId));
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: `council.${data.action}`,
      targetType: "council_session",
      targetId: sessionId,
      metadata: { selectedProposalId: selected },
    });
    if (data.action === "repeat_evaluation") {
      await tx
        .update(schema.workflowStage)
        .set({ status: "pending", completedAt: null, error: null })
        .where(and(eq(schema.workflowStage.sessionId, sessionId), eq(schema.workflowStage.phase, "final_verdict")));
    }
  });
  if (data.action === "request_more_debate")
    await enqueue(db, COUNCIL_JOB, { sessionId }, `${COUNCIL_JOB}:${sessionId}:${session.debateRoundsRun + 1}`, ctx.organizationId);
  if (data.action === "repeat_evaluation")
    await enqueue(db, COUNCIL_JOB, { sessionId }, `${COUNCIL_JOB}:${sessionId}:evaluation:${decision.id}`, ctx.organizationId);
  return { status: nextStatus };
}
