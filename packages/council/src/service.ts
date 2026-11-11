import {
  architectureChange,
  assertCan,
  can,
  splitObjections,
  assertTransition,
  buildPolicy,
  COUNCIL_PHASES,
  COUNCIL_PURPOSES,
  COUNCIL_ROLES,
  DECISION_MODES,
  contextFits,
  DomainError,
  estimateTokens,
  finalVerdictFit,
  finalVerdictFitMessage,
  MAX_CONCURRENT_SESSIONS,
  POLICY_VERSION,
  strengthSuggestion,
  voteWeightWarnings,
  type SessionStatus,
  minimumCouncilBudget,
  outputTokensFor,
  coverAllParticipants,
  roleSelectionSnapshot,
  suggestRoleProfiles,
  suggestRoles,
  type CouncilRole,
  type WorkflowPolicy,
} from "@consyrium/core";
import { isCouncilCapableModel } from "@consyrium/ai";
import {
  assertCurrentRequirementList,
  assertEntitlement,
  getSkillForUse,
  listRoleProfiles,
  snapshotRoleProfiles,
  latestRequirementList,
  lockProjectSources,
  newId,
  recordAudit,
  consumeMonthlyRun,
  refundMonthlyRun,
  schema,
  type ActorContext,
  type Database,
  assertNotDemoProject,
  assertNotDemoSession,
  assertSessionProjectWritable,
  recordDeletion,
  listInterventions,
} from "@consyrium/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { PROMPT_VERSION } from "./prompts";
import { latestStrengthCatalog } from "./model-strength";
import { validParticipation } from "./participation";
import { processQuality } from "./process-quality";
import { enqueue } from "./queue";
import {
  assertCanEvaluateSession,
  assertDecisionApprovable,
  assertDecisionRoundBinding,
  checkApprovalAfterMeasurement,
  checkPrototypeEligibility,
  decisionStatusOf,
  GATE_VERSION,
  pendingMeasurements,
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
  /** #597: what the user wants from the council – presentation of the result only, never the gate. */
  purpose: z.enum(COUNCIL_PURPOSES).optional(),
  /** Optional explicit role → participant (index into `participants`) mapping; default is round-robin. */
  roleAssignments: z.array(z.object({ role: z.enum(COUNCIL_ROLES), participantIndex: z.number().int().min(0) })).optional(),
  /** Required when the preview's upper bound exceeds the budget: the user accepted that phases may be shortened (#148). */
  confirmBudget: z.boolean().optional(),
  /** #136 (ChatGPT review): false = no extra perspectives for models without a role; default on. */
  extraRoles: z.boolean().optional(),
  /** Skill the setup was filled from (#363): pinned with version and content hash in the session. */
  skill: z.object({ id: z.string().min(1).max(200), version: z.number().int().min(1).optional() }).optional(),
  /**
   * Gesamttest 3: session rules taken over unchanged from a skill someone else wrote (official, adopted from the hub, a
   * team colleague's) need an explicit "I checked them" before the start; recorded in the audit log.
   */
  skillRulesConfirmed: z.boolean().optional(),
  /** Role profiles for active roles (#270): at most one per role, frozen with version and hash in the session. */
  roleProfiles: z.array(z.string().min(1).max(200)).max(12).optional(),
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

/** Refuses the start before any council call is paid when a model answers "model not found" to the start check. */
async function assertModelsCallable<P extends { credentialId: string; modelId: string }>(
  participants: P[],
  credentials: ReadonlyArray<{ id: string; provider: string }>,
  probe: NonNullable<ModelCatalog["probe"]>,
) {
  const results = await Promise.all(participants.map(async (p) => ({ p, result: await probe(p.credentialId, p.modelId).catch(() => "unknown" as const) })));
  const missing = results.filter((r) => r.result === "not_found").map((r) => r.p);
  if (missing.length > 0) {
    const named = missing.map((p) => `${p.modelId} (${credentials.find((c) => c.id === p.credentialId)?.provider ?? "unknown"} key)`).join(", ");
    throw new DomainError(
      "VALIDATION",
      `The provider lists these models but refuses calls with your key (HTTP 404): ${named}. Choose another model – nothing was charged for the council.`,
    );
  }
}

/** #136: the policy with an extra perspective for every model that would otherwise have none, and who takes each role. */
function withRoleCoverage(policy: WorkflowPolicy, data: SessionInput) {
  const full = coverAllParticipants(policy.roles, data.participants.length, data.roleAssignments);
  // Switched off by the user: the chosen roles only, round-robin as before (models without a role give no 12 Minds review).
  const coverage = data.extraRoles === false ? { assignments: full.assignments.filter((a) => policy.roles.includes(a.role)), added: [] } : full;
  return { coverage, policy: coverage.added.length ? { ...policy, roles: [...policy.roles, ...coverage.added.map((a) => a.role)] } : policy };
}

export async function previewSession(db: Database, ctx: ActorContext, projectId: string, input: SessionInput) {
  assertCan(ctx.role, "decision:run");
  const data = parse(sessionInput, input);
  assertCouncilModels(data.participants);
  const { policy: chosen, errors } = buildPolicy(data.mode, data);
  if (errors.length) throw new DomainError("VALIDATION", errors.join("; "));
  const { policy, coverage } = withRoleCoverage(chosen, data);
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
  // #228/#246: does every evaluator's Final Verdict fit into one call, or is it split? Counted on the latest confirmed list (the start
  // checks the current one again). A refusal is reported, not thrown, so the screen can disable the start.
  const requirementCount = (await latestRequirementList(db, ctx, projectId))?.items.length ?? 0;
  const fit = finalVerdictFit(data.participants.length, requirementCount);
  const finalVerdictSize = { ...fit, message: finalVerdictFitMessage(fit, data.participants.length, requirementCount) };
  const voteWeights = await voteWeightsFor(db, ctx, data.participants);
  // Warnings only (#170): a dominant share or a far-off weight is shown before the start, never silently capped.
  const warnings = voteWeightWarnings(
    data.participants.map((p, i) => ({ model: p.modelId, weight: voteWeights[i]!.weight, suggestion: voteWeights[i]!.suggestion })),
  );
  return { policy, ...preview, planLimit, finalVerdictSize, voteWeights, voteWeightWarnings: warnings, addedRoles: coverage.added };
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
 * The typical consumption as a range (#598): the median and the upper quartile of the tokens per call × the calls of this
 * configuration, never above the upper bound. A single median was too low – a few long calls (Final Verdict) carry a
 * council: two test councils on 10.11.26 were announced with 142,000 tokens and used 194,870 and 231,740.
 */
export function typicalRange(tokensPerCall: number[], calls: number, upperBound: number): { tokens: number; high: number; basedOnCalls: number } {
  const sorted = [...tokensPerCall].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const tokens = Math.min(upperBound, at(0.5) * calls);
  return { tokens, high: Math.max(tokens, Math.min(upperBound, at(0.75) * calls)), basedOnCalls: sorted.length };
}

/**
 * Upper bound and, where this workspace has enough history, the typical consumption (#148, as a range since #598):
 * median to upper quartile of the tokens per successful call of its latest councils × the calls of this configuration.
 * Measured, never invented.
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
  const requirementTotal = (await latestRequirementList(db, ctx, projectId))?.items.length ?? 0;
  const estimate = {
    // #246: a split Final Verdict adds calls per evaluator; the preview counts them.
    ...estimateTokens(policy, data.participants.length, chars, providers, requirementTotal),
    minimumBudget: minimumCouncilBudget(policy, chars, providers, requirementTotal),
  };
  const recent = await db
    .select({ tokens: sql<number>`(${schema.usageRecord.inputTokens} + ${schema.usageRecord.outputTokens})::int` })
    .from(schema.usageRecord)
    .where(and(eq(schema.usageRecord.organizationId, ctx.organizationId), eq(schema.usageRecord.outcome, "ok")))
    .orderBy(desc(schema.usageRecord.createdAt))
    .limit(TYPICAL_SAMPLE);
  const typical =
    recent.length >= TYPICAL_MIN_SAMPLE
      ? typicalRange(
          recent.map((r) => Number(r.tokens)),
          estimate.calls,
          estimate.upperBound,
        )
      : null;
  return {
    documents: documents.length,
    estimate: { ...estimate, typical },
    modelWarnings: await modelWarnings(db, ctx, data.participants, providers),
    contextFit: await contextFitFor(db, data.participants, providers, chars, policy),
  };
}

/** Recent calls of a model in this workspace that the preview warning is based on (#175). */
const WARNING_WINDOW_DAYS = 14;
const WARNING_MIN_CALLS = 6;

/**
 * Models that failed often in this workspace's recent councils (#175: Gemini Flash Latest timed out in run after run),
 * from the workspace's own usage rows – never a hardcoded list. With three models one failing provider plus one
 * broken answer is enough to lose the whole council, so the start screen says so before the run.
 */
/**
 * Start screen (#243): does the largest input of a council – the brief with its documents and repository context plus
 * every proposal (later phases show all of them) – leave room for an answer in each model's context window? The window
 * comes from the provider's models endpoint; `fits: null` when it is not reported. Content is never cut: a model that
 * does not fit is shown here, and its calls are refused instead of being sent to be cut off.
 */
async function contextFitFor(
  db: Database,
  participants: ReadonlyArray<{ modelId: string }>,
  providers: ReadonlyArray<string>,
  briefChars: number,
  policy: ReturnType<typeof buildPolicy>["policy"],
) {
  const rows = participants.length
    ? await db
        .select({ provider: schema.aiModel.provider, modelId: schema.aiModel.modelId, contextWindow: schema.aiModel.contextWindow })
        .from(schema.aiModel)
        .where(inArray(schema.aiModel.modelId, [...new Set(participants.map((p) => p.modelId))]))
    : [];
  return participants.map((participant, index) => {
    const provider = providers[index] ?? "";
    const contextWindow = rows.find((r) => r.modelId === participant.modelId && r.provider === provider)?.contextWindow ?? null;
    const proposals = participants.reduce((n, _, i) => n + outputTokensFor(providers[i] ?? "", policy.maxOutputTokens, "proposal"), 0);
    const estimatedInput = Math.ceil(briefChars / 4) + proposals;
    const wantedOutput = outputTokensFor(provider, policy.maxOutputTokens, "evaluation", Math.max(1, participants.length - 1));
    return { modelId: participant.modelId, contextWindow, estimatedInput, fits: contextFits(estimatedInput, wantedOutput, contextWindow) };
  });
}

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
  if (!proj || proj.status === "deleting") throw new DomainError("NOT_FOUND", "Project not found");
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
export type ModelCatalog = ((credentialId: string) => Promise<string[] | null>) & {
  /**
   * Optional start check: one tiny call per model. Providers sometimes list a model the key may not call (Google lists
   * gemini-2.5-pro for new keys but answers 404), so the list alone does not prove availability. "unknown" (timeout,
   * rate limit, provider down) never blocks the start – only a definite "not_found" does.
   */
  probe?: (credentialId: string, modelId: string) => Promise<"ok" | "not_found" | "unknown">;
};

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
  const { policy: chosen, errors } = buildPolicy(data.mode, data);
  if (errors.length) throw new DomainError("VALIDATION", errors.join("; "));
  const { policy, coverage } = withRoleCoverage(chosen, data);
  await assertNotDemoProject(db, ctx, projectId);
  const brief = await latestBrief(db, ctx, projectId);
  // Only on a requirement list confirmed for exactly this brief version and these documents (#190).
  const requirements = await assertCurrentRequirementList(db, ctx, projectId);
  if (requirements.state.briefId !== brief.id) throw new DomainError("CONFLICT", "The brief changed. Review and confirm the requirements again.");
  // #228/#246: refused before any model is paid only when not even one requirement per call fits; larger lists are split.
  const fit = finalVerdictFit(data.participants.length, requirements.list.items.length);
  if (!fit.fits) throw new DomainError("VALIDATION", finalVerdictFitMessage(fit, data.participants.length, requirements.list.items.length)!);
  await assertEntitlement(db, ctx.organizationId, "session", { participants: data.participants.length });
  const { estimate } = await costPreview(db, ctx, projectId, data, policy, brief);
  // Night test R4: below the minimum the council can never reach a verdict – refused before any model is paid,
  // also when shortened phases were accepted.
  if (policy.tokenBudget < estimate.minimumBudget)
    throw new DomainError(
      "VALIDATION",
      `The budget of ${policy.tokenBudget.toLocaleString("en-US")} tokens is too small for this team: at least ${estimate.minimumBudget.toLocaleString("en-US")} tokens are needed so every model can write a proposal and the Final Verdict can still run. Raise the budget or choose fewer models.`,
    );
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

  // #363 part 3: the skill is resolved now (archived skills are refused for new councils) and frozen in the session.
  const skill = data.skill ? await getSkillForUse(db, ctx, data.skill.id, data.skill.version) : null;
  const skillSnapshot = skill ? { ...skill.ref, ...(skill.content.knowledge ? { knowledge: skill.content.knowledge } : {}) } : null;
  const skillRules = skill?.content.sessionRules?.trim() ?? "";
  const rulesFromSkill = Boolean(skillRules && data.customRules?.includes(skillRules));
  const foreignSkill = Boolean(skill && (!skill.editable || skill.forkedFrom));
  if (rulesFromSkill && foreignSkill && data.skillRulesConfirmed !== true)
    throw new DomainError("VALIDATION", "Confirm that you checked the session rules taken over from the skill.", { reason: "skill_rules_unconfirmed" });
  // #270: chosen role profiles are resolved now (deactivated ones are refused) and frozen; each must belong to an active
  // role. A profile only sharpens that role's prompt – participants, votes and the gate stay exactly as configured.
  const roleProfiles = data.roleProfiles?.length ? await snapshotRoleProfiles(db, ctx, data.roleProfiles) : null;
  const inactive = (roleProfiles ?? []).filter((p) => !policy.roles.includes(p.content.role));
  if (inactive.length)
    throw new DomainError("VALIDATION", `Role profile for a role that is not active in this council: ${inactive.map((p) => p.content.name).join(", ")}`);
  // #269: what was suggested and why, and where each active role came from – recomputed here from the brief and the
  // confirmed list this council is bound to (never taken from the client), frozen next to the roles. Display only: it
  // changes no participant, vote, weight or gate.
  const suggestion = suggestRoles({ idea: brief.idea, goal: brief.goal, requirements: brief.requirements, confirmed: requirements.list.items });
  const roleSelection = roleSelectionSnapshot({
    suggestion,
    profileSuggestions: suggestRoleProfiles(suggestion, await listRoleProfiles(db, ctx)),
    chosen: chosen.roles,
    active: policy.roles,
    skillRoles: skill?.content.roles ?? null,
    profiles: Object.fromEntries((roleProfiles ?? []).map((p) => [p.content.role, p.profileId])) as Partial<Record<CouncilRole, string>>,
    models: data.participants.length,
    // API, MCP and Telegram starts may name no roles: the mode's standard team is then not "chosen by you".
    rolesChosen: Boolean(data.roles?.length),
  });

  // Credentials must belong to this organization; the provider comes from the stored credential.
  const credentialIds = [...new Set(data.participants.map((p) => p.credentialId))];
  const credentials = await db
    .select({ id: schema.aiProviderCredential.id, provider: schema.aiProviderCredential.provider })
    .from(schema.aiProviderCredential)
    .where(and(inArray(schema.aiProviderCredential.id, credentialIds), eq(schema.aiProviderCredential.organizationId, ctx.organizationId)));
  if (credentials.length !== credentialIds.length) throw new DomainError("VALIDATION", "Unknown API key selected");
  if (data.roleAssignments) {
    const assigned = new Set(data.roleAssignments.map((a) => a.role));
    const outside = data.roleAssignments.find((a) => !chosen.roles.includes(a.role));
    if (outside) throw new DomainError("VALIDATION", `Role ${outside.role} is assigned but not part of this council's roles`);
    if (data.roleAssignments.some((a) => a.participantIndex >= data.participants.length))
      throw new DomainError("VALIDATION", "Role assigned to an unknown model");
    if (chosen.roles.some((role) => !assigned.has(role)) || assigned.size !== data.roleAssignments.length)
      throw new DomainError("VALIDATION", "Every active role needs exactly one model");
  }
  // User decision 08.11.26 (replaces the #253 block): the same model may join again through ANOTHER key or account –
  // each instance with its own role and profile. Instances of one model are one independent voice everywhere
  // (independence groups: verdict, majority, judges, gate contract 6). The same model twice through the SAME key adds
  // nothing and stays refused. Model ids are compared case-insensitively (#144).
  const keys = data.participants.map((p) => `${p.credentialId}:${p.modelId.trim().toLowerCase()}`);
  if (new Set(keys).size !== keys.length) throw new DomainError("VALIDATION", "The same model can join a second time only through another API key or account");
  if (catalog) data.participants = await assertModelsAvailable(data.participants, credentials, catalog);
  if (catalog?.probe) await assertModelsCallable(data.participants, credentials, catalog.probe);

  // Fixed at the start: the weights and their suggestions cannot change during the run (#140).
  const weights = await voteWeightsFor(db, ctx, data.participants);
  const sessionId = newId("ses");
  await db.transaction(async (tx) => {
    // Checked again under the project lock (#181 review): brief, document and requirement changes take the same lock,
    // so a change either is seen here (refused) or waits until this session is stored.
    await lockProjectSources(tx, projectId);
    // #201: the monthly slot is booked in the same transaction as the session – a deleted session never gives it back,
    // and concurrent starts on the last free slot are serialised on the workspace row (the demo project cannot start one).
    await consumeMonthlyRun(tx, ctx.organizationId, "session", sessionId);
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
      skill: skillSnapshot,
      roleProfiles,
      roleSelection,
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
    // Roles are spread round-robin; models still without a role get an extra perspective (#136), so every model
    // gives its own critical review and preference in the 12 Minds Council.
    for (const { role, participantIndex } of coverage.assignments) {
      await tx.insert(schema.councilRoleAssignment).values({
        id: newId("rol"),
        organizationId: ctx.organizationId,
        sessionId,
        role,
        participantId: participantIds[participantIndex]!,
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
      metadata: {
        mode: data.mode,
        participants: data.participants.length,
        requirementListVersion: requirements.list.version,
        ...(skill
          ? {
              skill: { id: skill.ref.skillId, version: skill.ref.version, contentHash: skill.ref.contentHash },
              skillRulesTakenOver: rulesFromSkill,
              skillForeign: foreignSkill,
              skillRulesConfirmed: rulesFromSkill ? data.skillRulesConfirmed === true : null,
            }
          : {}),
      },
    });
  });
  await enqueue(db, COUNCIL_JOB, { sessionId }, `${COUNCIL_JOB}:${sessionId}:0`, ctx.organizationId);
  return { id: sessionId };
}

async function loadSession(db: Database, ctx: ActorContext, sessionId: string) {
  const [row] = await db
    .select({ session: schema.councilSession, projectStatus: schema.project.status })
    .from(schema.councilSession)
    .innerJoin(schema.project, eq(schema.project.id, schema.councilSession.projectId))
    .where(and(eq(schema.councilSession.id, sessionId), eq(schema.councilSession.organizationId, ctx.organizationId)));
  // #197: a session of a project being deleted is gone for every reader and writer.
  if (!row || row.projectStatus === "deleting") throw new DomainError("NOT_FOUND", "Session not found");
  return row.session;
}

export async function listSessions(db: Database, ctx: ActorContext, projectId?: string) {
  assertCan(ctx.role, "project:read");
  // #197: sessions of a project being deleted are not listed.
  const notDeleting = ne(schema.project.status, "deleting");
  const where = projectId
    ? and(eq(schema.councilSession.organizationId, ctx.organizationId), eq(schema.councilSession.projectId, projectId), notDeleting)
    : and(eq(schema.councilSession.organizationId, ctx.organizationId), notDeleting);
  return db
    .select({
      id: schema.councilSession.id,
      projectId: schema.councilSession.projectId,
      projectName: schema.project.name,
      // #197: lists hide sessions of archived projects by default.
      projectStatus: schema.project.status,
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
          // #15/#41: "intervention" rows (answers to a human after the verdict) are real cost but no phase contribution.
          kind: schema.usageRecord.kind,
          outcome: schema.usageRecord.outcome,
          calls: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${schema.usageRecord.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${schema.usageRecord.outputTokens}), 0)::int`,
          cachedInputTokens: sql<number>`coalesce(sum(${schema.usageRecord.cachedInputTokens}), 0)::int`,
        })
        .from(schema.usageRecord)
        .where(eq(schema.usageRecord.sessionId, sessionId))
        .groupBy(schema.usageRecord.participantId, schema.usageRecord.phase, schema.usageRecord.kind, schema.usageRecord.outcome),
      db.select().from(schema.minorityReview).where(eq(schema.minorityReview.sessionId, sessionId)),
      db.select().from(schema.consensusResult).where(eq(schema.consensusResult.sessionId, sessionId)),
      db.select().from(schema.projectBrief).where(eq(schema.projectBrief.id, session.briefId)),
      db
        // #548: the project state lets the client say "archived" instead of offering actions the server refuses.
        .select({
          id: schema.project.id,
          name: schema.project.name,
          deliveryDefault: schema.project.deliveryDefault,
          isDemo: schema.project.isDemo,
          status: schema.project.status,
        })
        .from(schema.project)
        .where(eq(schema.project.id, session.projectId)),
    ]);
  // The confirmed requirement list this run is bound to (#190); historic versions stay readable.
  const [requirementList] = session.requirementListId
    ? await db.select().from(schema.requirementList).where(eq(schema.requirementList.id, session.requirementListId))
    : [];
  const revealed = proposals.filter((p) => p.revealedAt);
  // #249 gate 2: recorded measurements (self-declarations with evidence) and who recorded them.
  const measurements = await db
    .select({
      id: schema.measurementResult.id,
      decisionId: schema.measurementResult.decisionId,
      proposalId: schema.measurementResult.proposalId,
      requirementId: schema.measurementResult.requirementId,
      planId: schema.measurementResult.planId,
      method: schema.measurementResult.method,
      target: schema.measurementResult.target,
      measured: schema.measurementResult.measured,
      met: schema.measurementResult.met,
      evidence: schema.measurementResult.evidence,
      recordedBy: schema.user.name,
      createdAt: schema.measurementResult.createdAt,
    })
    .from(schema.measurementResult)
    .innerJoin(schema.user, eq(schema.user.id, schema.measurementResult.recordedById))
    .where(eq(schema.measurementResult.sessionId, sessionId))
    .orderBy(asc(schema.measurementResult.createdAt), asc(schema.measurementResult.id));
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
          /** Names of the documents the list was confirmed against (context only, never requirements). */
          documents: requirementList.sourceState.documents.map((d) => d.name),
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
          latestMeasurementsByProposal(measurements, decision.id),
        )
      : null,
    // #249 gate 2: every recorded measurement, shown as "self-declared by <person>, evidence: …".
    measurements,
    // #249 part 2 / #478: the latest favourite or prototype mark on the current verdict – a human statement, not a verdict.
    humanMark: decision ? humanMarkOf(approvals, decision.id) : null,
    previousDecisions: decisions.filter((d) => d.supersededAt),
    approvals,
    // #15/#41: questions of a human after the verdict with the models' answers – an appendix, never part of the verdict.
    interventions: await listInterventions(db, ctx, sessionId),
    usage,
    callFailures,
    // Valid participation rate (#182), derived from the usage rows above.
    participation: validParticipation(participants, usage),
    // #182: process quality from stored data only – figures and status keys, worded by the clients.
    processQuality: processQuality({
      participation: validParticipation(participants, usage),
      participantIds: participants.map((p) => p.id),
      proposals: revealed.map((p) => ({ id: p.id, revisions: revisions.filter((r) => r.proposalId === p.id) })),
      objections: withMootness(objections, revisions),
      decision: decision ? { matrix: decision.matrix, recommendedProposalId: decision.recommendedProposalId } : null,
    }),
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
  // #408: a member stops only their own council; owners/admins (decision:approve) may stop any.
  if (session.createdById !== ctx.userId && !can(ctx.role, "decision:approve"))
    throw new DomainError("FORBIDDEN", "Only the person who started this council or an owner/admin can stop it");
  const status = session.status as SessionStatus;
  if (status === "queued") {
    assertTransition(status, "cancelled");
    await db.update(schema.councilSession).set({ status: "cancelled", finishedAt: new Date() }).where(eq(schema.councilSession.id, sessionId));
    // #201 refund policy: stopped before its first model call – the monthly slot is given back once.
    const [called] = await db.select({ id: schema.usageRecord.id }).from(schema.usageRecord).where(eq(schema.usageRecord.sessionId, sessionId)).limit(1);
    if (!called) await refundMonthlyRun(db, ctx.organizationId, "session", sessionId);
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
  action: z.enum([
    "approve",
    "reject",
    "request_more_debate",
    "request_changes",
    "select_alternative",
    "repeat_evaluation",
    // #249 part 2 / #478 – only from a signed-in session (the web route refuses API tokens for these).
    "mark_favorite",
    "approve_prototype",
    "approve_after_measurement",
  ]),
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
  await assertNotDemoSession(db, ctx, sessionId);
  // #197: an archived project is read-only – no approval, mark or measurement.
  await assertSessionProjectWritable(db, ctx, sessionId);
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
  /** Marks (#249 part 2) record a human statement; the session keeps waiting for the regular decision. */
  const loadProposal = async (id: string | undefined) => {
    if (!id) throw new DomainError("VALIDATION", "Select a proposal");
    const [p] = await db
      .select()
      .from(schema.proposal)
      .where(and(eq(schema.proposal.id, id), eq(schema.proposal.sessionId, sessionId)));
    if (!p) throw new DomainError("VALIDATION", "Unknown proposal");
    if (isBlocked(p.id)) throw new DomainError("CONFLICT", "This proposal is blocked by an unresolved critical security objection");
    return p;
  };
  switch (data.action) {
    case "mark_favorite":
    case "approve_prototype": {
      const p = await loadProposal(data.selectedProposalId);
      const eligible = checkPrototypeEligibility(decision, p.id);
      if (!eligible.ok) throw new DomainError("CONFLICT", eligible.reason);
      await assertDecisionRoundBinding(db, sessionId, decision);
      if (!data.comment)
        throw new DomainError(
          "VALIDATION",
          data.action === "mark_favorite" ? "Explain why this proposal is your favourite" : "Explain what the prototype build should measure",
        );
      selected = p.id;
      nextStatus = "awaiting_approval";
      break;
    }
    case "approve_after_measurement": {
      const p = await loadProposal(data.selectedProposalId);
      const check = checkApprovalAfterMeasurement(decision, p.id, await latestMeasurements(db, decision.id, p.id));
      if (!check.ok) throw new DomainError("CONFLICT", check.reason);
      await assertDecisionRoundBinding(db, sessionId, decision);
      selected = p.id;
      nextStatus = "approved";
      break;
    }
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
  // A mark keeps the status; every other action is a transition of the state machine.
  if (nextStatus !== session.status) assertTransition(session.status as SessionStatus, nextStatus);

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
    if (nextStatus !== session.status)
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

/**
 * Recorded measurements per requirement of one proposal of one verdict (#249 gate 2): requirement id → met. A single
 * "not met" stays decisive (owner decision 08.11.26: a measured miss blocks the proposal for good); otherwise met.
 */
export async function latestMeasurements(db: Database, decisionId: string, proposalId: string): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ requirementId: schema.measurementResult.requirementId, met: schema.measurementResult.met })
    .from(schema.measurementResult)
    .where(and(eq(schema.measurementResult.decisionId, decisionId), eq(schema.measurementResult.proposalId, proposalId)))
    .orderBy(asc(schema.measurementResult.createdAt), asc(schema.measurementResult.id));
  const latest = new Map<string, boolean>();
  for (const r of rows) latest.set(r.requirementId, latest.get(r.requirementId) === false ? false : r.met);
  return latest;
}

export const measurementInput = z.object({
  proposalId: z.string().min(1),
  requirementId: z.string().min(1).max(20),
  planId: z.string().optional(),
  method: z.string().trim().min(3).max(1_000),
  target: z.string().trim().min(1).max(500),
  measured: z.string().trim().min(1).max(500),
  met: z.boolean(),
  evidence: z.string().trim().min(3).max(2_000),
});

/**
 * #249 gate 2 – records the measured result of one open measurement of a proposal (owner decision 08.11.26): a
 * self-declaration with mandatory evidence by a person with the approval role, append-only and audited. The web route
 * accepts it only from a signed-in session – never an API token, MCP or an agent. Only requirements the stored gate
 * result marks measurementPending for this proposal, only on the current verdict of a session waiting for a decision.
 */
export async function recordMeasurement(db: Database, ctx: ActorContext, sessionId: string, input: z.input<typeof measurementInput>) {
  await assertNotDemoSession(db, ctx, sessionId);
  // #197: an archived project is read-only – no approval, mark or measurement.
  await assertSessionProjectWritable(db, ctx, sessionId);
  assertCan(ctx.role, "decision:approve");
  const data = parse(measurementInput, input);
  const session = await loadSession(db, ctx, sessionId);
  if (session.status !== "awaiting_approval") throw new DomainError("CONFLICT", "Measurements are recorded while the session waits for a decision");
  const [decision] = await db
    .select()
    .from(schema.finalDecision)
    .where(and(eq(schema.finalDecision.sessionId, sessionId), isNull(schema.finalDecision.supersededAt)));
  if (!decision) throw new DomainError("CONFLICT", "No verdict available");
  const eligible = checkPrototypeEligibility(decision, data.proposalId);
  if (!eligible.ok) throw new DomainError("CONFLICT", eligible.reason);
  if ((await latestMeasurements(db, decision.id, data.proposalId)).get(data.requirementId) === false)
    throw new DomainError("CONFLICT", "This requirement was measured as not met; the proposal cannot be approved after measurement.");
  if (!pendingMeasurements(decision, data.proposalId).includes(data.requirementId))
    throw new DomainError("VALIDATION", "This requirement has no open measurement for this proposal");
  if (data.planId) {
    const [plan] = await db
      .select({ id: schema.developmentPlan.id })
      .from(schema.developmentPlan)
      .where(
        and(
          eq(schema.developmentPlan.id, data.planId),
          eq(schema.developmentPlan.sessionId, sessionId),
          eq(schema.developmentPlan.proposalId, data.proposalId),
        ),
      );
    if (!plan) throw new DomainError("VALIDATION", "Unknown build run for this proposal");
  }
  const id = newId("msr");
  await db.transaction(async (tx) => {
    await tx.insert(schema.measurementResult).values({
      id,
      organizationId: ctx.organizationId,
      sessionId,
      decisionId: decision.id,
      proposalId: data.proposalId,
      requirementId: data.requirementId,
      planId: data.planId ?? null,
      method: data.method,
      target: data.target,
      measured: data.measured,
      met: data.met,
      evidence: data.evidence,
      recordedById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "council.measurement_recorded",
      targetType: "council_session",
      targetId: sessionId,
      // Shown as a self-declaration everywhere; the evidence text itself stays in the row, not in the audit metadata.
      metadata: { proposalId: data.proposalId, requirementId: data.requirementId, met: data.met, selfDeclared: true },
    });
  });
  return { id };
}

function latestMeasurementsByProposal(
  rows: ReadonlyArray<{ decisionId: string; proposalId: string; requirementId: string; met: boolean }>,
  decisionId: string,
) {
  const byProposal = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    if (r.decisionId !== decisionId) continue;
    const own = byProposal.get(r.proposalId) ?? new Map<string, boolean>();
    // Same rule as latestMeasurements: one measured miss stays decisive.
    own.set(r.requirementId, own.get(r.requirementId) === false ? false : r.met);
    byProposal.set(r.proposalId, own);
  }
  return byProposal;
}

/** The latest favourite/prototype mark of the current verdict (#249 part 2), or null. Rows are in creation order. */
function humanMarkOf(
  approvals: ReadonlyArray<{ action: string; decisionId: string; selectedProposalId: string | null; comment: string; createdAt: Date }>,
  decisionId: string,
): { kind: "favorite" | "prototype_build"; proposalId: string; comment: string; createdAt: Date } | null {
  const mark = approvals.filter((a) => a.decisionId === decisionId && (a.action === "mark_favorite" || a.action === "approve_prototype")).at(-1);
  if (!mark?.selectedProposalId) return null;
  return {
    kind: mark.action === "approve_prototype" ? "prototype_build" : "favorite",
    proposalId: mark.selectedProposalId,
    comment: mark.comment,
    createdAt: mark.createdAt,
  };
}

const ACTIVE_SESSION = ["queued", "running", "cancel_requested"];
const ACTIVE_PLAN = ["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"];

/**
 * #198 – deletes one council session with everything that belongs to it (proposals, verdicts, approvals, measurements,
 * builds, delivery log – cascade); the project, its briefs, requirement lists and other sessions stay. Owner decision
 * 08.11.26: always the whole session, never a single verdict; offer the report export first; no archive. Only a session
 * that does not run: a running council must be stopped and an active build cancelled first, so nothing can write after
 * the deletion (checked under a lock on the session row). Queued jobs of the session are failed. The plan usage ledger
 * (#201) is not touched. Audited with counts only.
 */
export async function deleteSession(db: Database, ctx: ActorContext, sessionId: string, confirmName: string) {
  assertCan(ctx.role, "project:delete");
  await assertNotDemoSession(db, ctx, sessionId);
  const session = await loadSession(db, ctx, sessionId);
  const [project] = await db.select({ name: schema.project.name }).from(schema.project).where(eq(schema.project.id, session.projectId));
  if (project?.name !== confirmName) throw new DomainError("VALIDATION", "Type the project name to confirm");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Session not found");
    if (ACTIVE_SESSION.includes(row.status)) throw new DomainError("CONFLICT", "This council is still running. Stop it first, then delete the session.");
    const plans = await tx
      .select({ id: schema.developmentPlan.id, status: schema.developmentPlan.status })
      .from(schema.developmentPlan)
      .where(eq(schema.developmentPlan.sessionId, sessionId));
    if (plans.some((p) => ACTIVE_PLAN.includes(p.status)))
      throw new DomainError("CONFLICT", "A build of this session is still active. Cancel it first, then delete the session.");
    const ids = [sessionId, ...plans.map((p) => p.id)];
    await tx
      .update(schema.job)
      .set({ status: "failed", lastError: "The session was deleted.", lockedUntil: null })
      .where(
        and(eq(schema.job.status, "queued"), or(inArray(sql`${schema.job.payload}->>'sessionId'`, ids), inArray(sql`${schema.job.payload}->>'planId'`, ids))),
      );
    const decisions = await tx.select({ id: schema.finalDecision.id }).from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, sessionId));
    await tx.delete(schema.councilSession).where(eq(schema.councilSession.id, sessionId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "privacy.session_deleted",
      targetType: "project",
      targetId: row.projectId,
      // Counts and ids only – no brief, verdict or report text.
      metadata: { sessionId, verdicts: decisions.length, builds: plans.length },
    });
  });
  // #206: after the delete and outside the transaction – a restored backup must not bring the session back.
  await recordDeletion(db, { kind: "session", id: sessionId, organizationId: ctx.organizationId, deletedAt: new Date() });
}

/** #182 PR 2: at most this many recent councils with a verdict are summarised on the workspace overview. */
export const PROCESS_QUALITY_OVERVIEW_LIMIT = 50;

/**
 * #182 – process quality of the workspace's recent councils (figures only, no content), for /decisions/quality: the
 * same per-council figures as the session view, plus a summary. Only councils of this workspace with a current verdict;
 * projects being deleted are left out. Computed on read from stored data – no model call.
 */
export async function workspaceProcessQuality(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "project:read");
  const sessions = await db
    .select({ id: schema.councilSession.id, projectName: schema.project.name, mode: schema.councilSession.mode, createdAt: schema.councilSession.createdAt })
    .from(schema.councilSession)
    .innerJoin(schema.project, eq(schema.project.id, schema.councilSession.projectId))
    .innerJoin(schema.finalDecision, and(eq(schema.finalDecision.sessionId, schema.councilSession.id), isNull(schema.finalDecision.supersededAt)))
    .where(and(eq(schema.councilSession.organizationId, ctx.organizationId), ne(schema.project.status, "deleting")))
    .orderBy(desc(schema.councilSession.createdAt))
    .limit(PROCESS_QUALITY_OVERVIEW_LIMIT);
  const ids = sessions.map((s) => s.id);
  if (!ids.length) return { councils: [], summary: null };
  const [participants, usage, proposals, revisions, objections, decisions] = await Promise.all([
    db
      .select({ id: schema.councilParticipant.id, sessionId: schema.councilParticipant.sessionId, status: schema.councilParticipant.status })
      .from(schema.councilParticipant)
      .where(inArray(schema.councilParticipant.sessionId, ids)),
    db
      .select({
        sessionId: schema.usageRecord.sessionId,
        participantId: schema.usageRecord.participantId,
        phase: schema.usageRecord.phase,
        outcome: schema.usageRecord.outcome,
        calls: sql<number>`count(*)::int`,
      })
      .from(schema.usageRecord)
      .where(inArray(schema.usageRecord.sessionId, ids))
      .groupBy(schema.usageRecord.sessionId, schema.usageRecord.participantId, schema.usageRecord.phase, schema.usageRecord.outcome),
    db
      .select({ id: schema.proposal.id, sessionId: schema.proposal.sessionId, revealedAt: schema.proposal.revealedAt })
      .from(schema.proposal)
      .where(inArray(schema.proposal.sessionId, ids)),
    db
      .select({
        proposalId: schema.proposalRevision.proposalId,
        version: schema.proposalRevision.version,
        content: schema.proposalRevision.content,
        createdAt: schema.proposalRevision.createdAt,
      })
      .from(schema.proposalRevision)
      .innerJoin(schema.proposal, eq(schema.proposal.id, schema.proposalRevision.proposalId))
      .where(inArray(schema.proposal.sessionId, ids)),
    db.select().from(schema.minorityObjection).where(inArray(schema.minorityObjection.sessionId, ids)),
    db
      .select({
        sessionId: schema.finalDecision.sessionId,
        matrix: schema.finalDecision.matrix,
        recommendedProposalId: schema.finalDecision.recommendedProposalId,
      })
      .from(schema.finalDecision)
      .where(and(inArray(schema.finalDecision.sessionId, ids), isNull(schema.finalDecision.supersededAt))),
  ]);
  const councils = sessions.map((s) => {
    const own = participants.filter((p) => p.sessionId === s.id);
    const ownProposals = proposals.filter((p) => p.sessionId === s.id && p.revealedAt);
    const ownRevisions = revisions.filter((r) => ownProposals.some((p) => p.id === r.proposalId));
    const decision = decisions.find((d) => d.sessionId === s.id) ?? null;
    return {
      sessionId: s.id,
      projectName: s.projectName,
      mode: s.mode,
      createdAt: s.createdAt,
      quality: processQuality({
        participation: validParticipation(
          own,
          usage.filter((u) => u.sessionId === s.id),
        ),
        participantIds: own.map((p) => p.id),
        proposals: ownProposals.map((p) => ({ id: p.id, revisions: ownRevisions.filter((r) => r.proposalId === p.id) })),
        objections: withMootness(
          objections.filter((o) => o.sessionId === s.id),
          ownRevisions,
        ),
        decision,
      }),
    };
  });
  const q = councils.map((c) => c.quality);
  const objectionTotal = q.reduce((a, x) => a + x.objections.total, 0);
  return {
    councils,
    summary: {
      councils: councils.length,
      fullParticipation: q.filter((x) => x.participation && x.participation.total > 0 && x.participation.valid === x.participation.total).length,
      convergence: {
        strong: q.filter((x) => x.convergence.measurable && x.convergence.level === "strong").length,
        moderate: q.filter((x) => x.convergence.measurable && x.convergence.level === "moderate").length,
        little: q.filter((x) => x.convergence.measurable && x.convergence.level === "little").length,
        notMeasurable: q.filter((x) => !x.convergence.measurable).length,
      },
      objections: {
        total: objectionTotal,
        survived: q.reduce((a, x) => a + x.objections.survived, 0),
        withoutEffect: q.reduce((a, x) => a + x.objections.effects.none, 0),
      },
      weightChangedWinner: q.filter((x) => x.weight.measurable && x.weight.changedWinner).length,
    },
  };
}

/** #12: events of the last seconds are held back – a write that started earlier may still commit (see sessionTimeline). */
export const TIMELINE_SETTLE_MS = 5_000;
const TIMELINE_LIVE = new Set(["queued", "running", "cancel_requested"]);

export type TimelineEventKind = "message" | "call" | "stage" | "revision" | "score" | "vote" | "objection" | "verdict" | "approval" | "build";
export interface TimelineEvent {
  /** Stable per event: `<source>:<row id>[:start|:end]` – clients deduplicate by it. */
  id: string;
  cursor: string;
  at: string;
  kind: TimelineEventKind;
  phase: string | null;
  participantId: string | null;
  data: Record<string, unknown>;
}

const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(cursor: string | null | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString();
  const sep = raw.indexOf("|");
  const at = Date.parse(raw.slice(0, sep));
  if (sep < 0 || Number.isNaN(at)) throw new DomainError("VALIDATION", "Invalid cursor");
  return { at, id: raw.slice(sep + 1) };
}

/**
 * #12 – the run as an ordered event list for live views, replay and polling clients (VS Code, MCP): contributions,
 * model calls with tokens, phase starts/ends, objections, the verdict, human decisions and builds. No text, prompt or
 * proposal content – ids, kinds and figures only. Workspace-scoped through the session check.
 *
 * Cursor: (timestamp, event id), strictly increasing – resuming with `after` gives every later event exactly once.
 * Timestamp cursors over several tables can lose a row whose transaction started earlier but commits after a read; so
 * events younger than TIMELINE_SETTLE_MS are held back until they are settled. `complete` is true once the run is in
 * a final state and nothing newer than the returned events exists.
 */
export async function sessionTimeline(
  db: Database,
  ctx: ActorContext,
  sessionId: string,
  options: { after?: string | null; limit?: number; now?: Date } = {},
): Promise<{ events: TimelineEvent[]; nextCursor: string | null; complete: boolean }> {
  assertCan(ctx.role, "project:read");
  const session = await loadSession(db, ctx, sessionId);
  const after = decodeCursor(options.after);
  const limit = Math.min(Math.max(1, options.limit ?? 200), 500);
  const horizon = (options.now ?? new Date()).getTime() - TIMELINE_SETTLE_MS;
  const [messages, calls, stages, objections, decisions, approvals, plans, revisions, scores, votes] = await Promise.all([
    db
      .select({
        id: schema.debateMessage.id,
        at: schema.debateMessage.createdAt,
        phase: schema.debateMessage.phase,
        participantId: schema.debateMessage.participantId,
        kind: schema.debateMessage.kind,
        round: schema.debateMessage.round,
        role: schema.debateMessage.role,
        targetProposalId: schema.debateMessage.targetProposalId,
        parentId: schema.debateMessage.parentId,
        category: schema.debateMessage.category,
        severity: schema.debateMessage.severity,
      })
      .from(schema.debateMessage)
      .where(eq(schema.debateMessage.sessionId, sessionId)),
    db
      .select({
        id: schema.usageRecord.id,
        at: schema.usageRecord.createdAt,
        phase: schema.usageRecord.phase,
        participantId: schema.usageRecord.participantId,
        outcome: schema.usageRecord.outcome,
        inputTokens: schema.usageRecord.inputTokens,
        outputTokens: schema.usageRecord.outputTokens,
        cachedInputTokens: schema.usageRecord.cachedInputTokens,
      })
      .from(schema.usageRecord)
      .where(eq(schema.usageRecord.sessionId, sessionId)),
    db.select().from(schema.workflowStage).where(eq(schema.workflowStage.sessionId, sessionId)),
    db
      .select({
        id: schema.minorityObjection.id,
        at: schema.minorityObjection.createdAt,
        status: schema.minorityObjection.status,
        severity: schema.minorityObjection.severity,
        proposalId: schema.minorityObjection.proposalId,
        participantId: schema.minorityObjection.raisedByParticipantId,
      })
      .from(schema.minorityObjection)
      .where(eq(schema.minorityObjection.sessionId, sessionId)),
    db
      .select({
        id: schema.finalDecision.id,
        at: schema.finalDecision.createdAt,
        outcome: schema.finalDecision.outcome,
        gateVersion: schema.finalDecision.gateVersion,
      })
      .from(schema.finalDecision)
      .where(eq(schema.finalDecision.sessionId, sessionId)),
    db
      .select({
        id: schema.humanApproval.id,
        at: schema.humanApproval.createdAt,
        action: schema.humanApproval.action,
        proposalId: schema.humanApproval.selectedProposalId,
      })
      .from(schema.humanApproval)
      .where(eq(schema.humanApproval.sessionId, sessionId)),
    db
      .select({ id: schema.developmentPlan.id, at: schema.developmentPlan.createdAt, status: schema.developmentPlan.status, kind: schema.developmentPlan.kind })
      .from(schema.developmentPlan)
      .where(eq(schema.developmentPlan.sessionId, sessionId)),
    db
      .select({
        id: schema.proposalRevision.id,
        at: schema.proposalRevision.createdAt,
        proposalId: schema.proposalRevision.proposalId,
        version: schema.proposalRevision.version,
        phase: schema.proposalRevision.phase,
      })
      .from(schema.proposalRevision)
      .innerJoin(schema.proposal, eq(schema.proposal.id, schema.proposalRevision.proposalId))
      .where(eq(schema.proposal.sessionId, sessionId)),
    // Scores grouped per evaluator and revision (one event per evaluation, not per criterion).
    db
      .select({
        evaluatorParticipantId: schema.evaluationScore.evaluatorParticipantId,
        revisionId: schema.evaluationScore.revisionId,
        at: sql<Date>`max(${schema.evaluationScore.createdAt})`,
        criteria: sql<number>`count(*)::int`,
      })
      .from(schema.evaluationScore)
      .where(eq(schema.evaluationScore.sessionId, sessionId))
      .groupBy(schema.evaluationScore.evaluatorParticipantId, schema.evaluationScore.revisionId),
    db
      .select({ id: schema.vote.id, at: schema.vote.createdAt, evaluatorParticipantId: schema.vote.evaluatorParticipantId, ranking: schema.vote.ranking })
      .from(schema.vote)
      .where(eq(schema.vote.sessionId, sessionId)),
  ]);
  type Raw = Omit<TimelineEvent, "cursor" | "at"> & { atDate: Date };
  const raw: Raw[] = [
    ...messages.map(
      (m): Raw => ({
        id: `message:${m.id}`,
        atDate: m.at,
        kind: "message",
        phase: m.phase,
        participantId: m.participantId,
        // For the replay's network lines (31): who answered what, at which round – never the text.
        data: {
          messageKind: m.kind,
          round: m.round,
          ...(m.role ? { role: m.role } : {}),
          ...(m.targetProposalId ? { targetProposalId: m.targetProposalId } : {}),
          ...(m.parentId ? { parentId: m.parentId } : {}),
          ...(m.category ? { category: m.category } : {}),
          ...(m.severity ? { severity: m.severity } : {}),
        },
      }),
    ),
    ...revisions.map(
      (r): Raw => ({
        id: `revision:${r.id}`,
        atDate: r.at,
        kind: "revision",
        phase: r.phase,
        participantId: null,
        data: { proposalId: r.proposalId, version: r.version },
      }),
    ),
    ...scores.map(
      (s): Raw => ({
        id: `score:${s.evaluatorParticipantId}:${s.revisionId}`,
        atDate: new Date(s.at),
        kind: "score",
        phase: "final_verdict",
        participantId: s.evaluatorParticipantId,
        data: { revisionId: s.revisionId, criteria: s.criteria },
      }),
    ),
    ...votes.map(
      (v): Raw => ({
        id: `vote:${v.id}`,
        atDate: v.at,
        kind: "vote",
        phase: "final_verdict",
        participantId: v.evaluatorParticipantId,
        data: { ranking: v.ranking },
      }),
    ),
    ...calls.map(
      (c): Raw => ({
        id: `call:${c.id}`,
        atDate: c.at,
        kind: "call",
        phase: c.phase,
        participantId: c.participantId,
        data: { outcome: c.outcome, inputTokens: c.inputTokens, outputTokens: c.outputTokens, cachedInputTokens: c.cachedInputTokens },
      }),
    ),
    ...stages.flatMap((s): Raw[] => [
      ...(s.startedAt
        ? [
            {
              id: `stage:${s.id}:start`,
              atDate: s.startedAt,
              kind: "stage" as const,
              phase: s.phase,
              participantId: null,
              data: { event: "started", status: "running" },
            },
          ]
        : []),
      ...(s.completedAt
        ? [
            {
              id: `stage:${s.id}:end`,
              atDate: s.completedAt,
              kind: "stage" as const,
              phase: s.phase,
              participantId: null,
              data: { event: "completed", status: s.status },
            },
          ]
        : []),
    ]),
    ...objections.map(
      (o): Raw => ({
        id: `objection:${o.id}`,
        atDate: o.at,
        kind: "objection",
        phase: "minority_review",
        participantId: o.participantId,
        data: { status: o.status, severity: o.severity, proposalId: o.proposalId },
      }),
    ),
    ...decisions.map(
      (d): Raw => ({
        id: `verdict:${d.id}`,
        atDate: d.at,
        kind: "verdict",
        phase: "final_verdict",
        participantId: null,
        data: { outcome: d.outcome, gateVersion: d.gateVersion },
      }),
    ),
    ...approvals.map(
      (a): Raw => ({
        id: `approval:${a.id}`,
        atDate: a.at,
        kind: "approval",
        phase: null,
        participantId: null,
        data: { action: a.action, ...(a.proposalId ? { proposalId: a.proposalId } : {}) },
      }),
    ),
    ...plans.map(
      (p): Raw => ({
        id: `build:${p.id}`,
        atDate: p.at,
        kind: "build",
        phase: "execution_council",
        participantId: null,
        data: { status: p.status, buildKind: p.kind },
      }),
    ),
  ];
  const ordered = raw.sort((a, b) => a.atDate.getTime() - b.atDate.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const newer = ordered.filter((e) => !after || e.atDate.getTime() > after.at || (e.atDate.getTime() === after.at && e.id > after.id));
  const settled = newer.filter((e) => e.atDate.getTime() <= horizon);
  const page = settled.slice(0, limit);
  const events = page.map(({ atDate, ...e }) => ({ ...e, at: atDate.toISOString(), cursor: encodeCursor(atDate, e.id) }));
  const last = events.at(-1);
  return {
    events,
    nextCursor: last?.cursor ?? options.after ?? null,
    complete: !TIMELINE_LIVE.has(session.status) && newer.length === page.length,
  };
}

/** #12: running totals of a session for live clients – figures only, small enough to send on every change. */
export interface SessionUsageSnapshot {
  status: string;
  /** The phase the run is in now (null before the first phase starts). */
  phase: string | null;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** The session counter: recorded usage plus reservations of calls still running (#173). */
  tokensUsed: number;
  tokenBudget: number;
  /** tokensUsed / tokenBudget, 0..1 (rounded to three places). */
  share: number;
  /** Calls without a council phase (e.g. later questions to the models, #15/#41) – counted apart, not in the phases. */
  phaseless: { calls: number; tokens: number };
}

export function sessionUsageSnapshot(view: Pick<SessionView, "session" | "usage">): SessionUsageSnapshot {
  let calls = 0;
  let failedCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  const phaseless = { calls: 0, tokens: 0 };
  for (const u of view.usage) {
    const n = Number(u.calls);
    const tokens = Number(u.inputTokens) + Number(u.outputTokens);
    calls += n;
    if (u.outcome !== "ok") failedCalls += n;
    inputTokens += Number(u.inputTokens);
    outputTokens += Number(u.outputTokens);
    cachedInputTokens += Number(u.cachedInputTokens ?? 0);
    if (!u.phase) {
      phaseless.calls += n;
      phaseless.tokens += tokens;
    }
  }
  const { tokensUsed, tokenBudget } = view.session;
  return {
    status: view.session.status,
    phase: view.session.currentPhase ?? null,
    calls,
    failedCalls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    tokensUsed,
    tokenBudget,
    share: tokenBudget > 0 ? Math.round((tokensUsed / tokenBudget) * 1000) / 1000 : 0,
    phaseless,
  };
}
