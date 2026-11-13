import { relations } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  ExcludedRequirement,
  RequirementItem,
  RoleProfileSessionSnapshot,
  RoleSelectionSnapshot,
  SkillForkRef,
  PublicationScanResult,
  SkillSessionSnapshot,
} from "@consyrium/core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ---------- Authentication (shape required by Better Auth) ---------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/* ---------- Tenancy ---------- */

export const orgRole = pgEnum("org_role", ["owner", "admin", "member", "viewer"]);

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** When the read-only demo project was copied into this workspace; set once, so a deleted demo never comes back. */
  demoSeededAt: timestamp("demo_seeded_at", { withTimezone: true }),
  ...timestamps,
});

export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("membership_org_user_uq").on(t.organizationId, t.userId), index("membership_user_idx").on(t.userId)],
);

/* ---------- GitHub (Milestone 5) ---------- */

/** One GitHub App installation linked to a Consyrium organization. */
export const githubIntegration = pgTable(
  "github_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    repositorySelection: text("repository_selection").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("github_org_installation_uq").on(t.organizationId, t.installationId)],
);

/* ---------- Projects ---------- */

export const projectType = pgEnum("project_type", ["idea", "architecture", "repository", "business", "technology_choice"]);
/** #197 (ADR 0197): "deleting" – deletion requested, invisible and locked until the purge job has removed the project. */
export const projectStatus = pgEnum("project_status", ["draft", "ready", "archived", "deleting"]);
export const projectIntent = pgEnum("project_intent", ["decision", "build", "both"]);

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: projectType("type").notNull(),
    status: projectStatus("status").notNull().default("draft"),
    /** What the user wants at the end: a decision, development, or both. */
    intent: projectIntent("intent").notNull().default("decision"),
    /** Linked repository (via the organization's GitHub App installation). */
    githubIntegrationId: text("github_integration_id").references(() => githubIntegration.id, { onDelete: "set null" }),
    repositoryFullName: text("repository_full_name"),
    repositoryDefaultBranch: text("repository_default_branch"),
    /** Default delivery target of this project's decisions (#165), preselected under "Send to …". */
    /** Read-only demo copy of a finished council (owner decision 08.11.26): no councils, approvals or builds, no plan limit. */
    isDemo: boolean("is_demo").notNull().default(false),
    deliveryDefault: jsonb("delivery_default").$type<{ target: "email" | "telegram" | "confluence"; connectionId?: string | null; recipients?: string[] }>(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (t) => [index("project_org_idx").on(t.organizationId)],
);

/** Briefs are append-only: every edit creates a new version so councils can cite the exact brief they saw. */
export const projectBrief = pgTable(
  "project_brief",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    idea: text("idea").notNull(),
    goal: text("goal").notNull().default(""),
    requirements: text("requirements").notNull().default(""),
    repositoryUrl: text("repository_url"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_brief_version_uq").on(t.projectId, t.version)],
);

/** Text documents attached to a project (requirements, notes, code excerpts). Immutable once uploaded. */
export const projectDocument = pgTable(
  "project_document",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Text for the models: the file, the extracted text of a PDF/DOCX/PPTX, or the confirmed description of an image. */
    content: text("content").notNull(),
    /** Images only (docs/documents.md): the image as base64; it is sent once to the describing model, never to a council. */
    imageData: text("image_data"),
    /** Images only: "pending" (no description), "draft" (described, not yet reviewed), "confirmed" (content is final). */
    descriptionStatus: text("description_status"),
    /** Images only: provider/model that wrote the draft, kept for the audit trail. */
    describedBy: text("described_by"),
    /**
     * "source": scanned for requirement candidates (uploads). "context": read by the models but never a source of
     * requirements – the repository context of a Decision council (docs/documents.md).
     */
    role: text("role").notNull().default("source"),
    /**
     * Where a generated document came from: the repository, commit and files of a repository context, or the file
     * excerpts an external client (MCP ask_consyrium, #331) sent with its question.
     */
    origin: jsonb("origin").$type<
      | {
          kind: "github";
          repository: string;
          branch: string;
          commitSha: string;
          paths: string[];
          skipped: Array<{ path: string; reason: string }>;
        }
      | { kind: "client"; client: "mcp"; paths: string[] }
    >(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_document_project_idx").on(t.projectId)],
);

/**
 * Confirmed hard requirements of a project (#190), one row per confirmed version. Bound to the brief version and to
 * the source state it was confirmed against (brief fields plus the exact set of documents and their hashes): any later
 * change of the brief or the documents makes it stale, and a council only starts on a list matching the current state.
 * Rows are immutable; ids R1…Rn are only unique together with the list id.
 */
export const requirementList = pgTable(
  "requirement_list",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    briefId: text("brief_id")
      .notNull()
      .references(() => projectBrief.id),
    /** sha256 over brief id, idea, goal, requirements and the sorted document ids with their content hashes. */
    sourceHash: text("source_hash").notNull(),
    sourceState: jsonb("source_state")
      .$type<{ briefId: string; briefVersion: number; documents: Array<{ id: string; name: string; sha256: string }> }>()
      .notNull(),
    items: jsonb("items").$type<RequirementItem[]>().notNull(),
    /** Proposed statements the user deliberately did not take over, each with origin and reason. */
    excluded: jsonb("excluded").$type<ExcludedRequirement[]>().notNull().default([]),
    /** The user confirmed explicitly that the brief has no hard requirement (only with an empty list). */
    noHardRequirements: boolean("no_hard_requirements").notNull().default(false),
    confirmedById: text("confirmed_by_id")
      .notNull()
      .references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("requirement_list_version_uq").on(t.projectId, t.version)],
);

/* ---------- AI providers and credentials ---------- */

export const aiProviderId = pgEnum("ai_provider_id", ["anthropic", "openai", "google", "deepseek", "glm", "kimi", "qwen", "xai"]);

/** Cache of models discovered from provider APIs. Never seeded with invented model names. */
export const aiModel = pgTable(
  "ai_model",
  {
    id: text("id").primaryKey(),
    provider: aiProviderId("provider").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    supportsStructuredOutput: boolean("supports_structured_output"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_model_provider_model_uq").on(t.provider, t.modelId)],
);

export const aiProviderCredential = pgTable(
  "ai_provider_credential",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: aiProviderId("provider").notNull(),
    label: text("label").notNull(),
    /** AES-256-GCM envelope, see @consyrium/core crypto. Never returned by any API. */
    encryptedSecret: text("encrypted_secret").notNull(),
    keyVersion: integer("key_version").notNull(),
    secretHint: text("secret_hint").notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationError: text("last_validation_error"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("credential_org_provider_label_uq").on(t.organizationId, t.provider, t.label)],
);

/* ---------- Audit ---------- */

export const auditEvent = pgTable(
  "audit_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    /** Must never contain secrets or private repository content. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);

/* ---------- Relations ---------- */

export const organizationRelations = relations(organization, ({ many }) => ({
  memberships: many(membership),
  projects: many(project),
}));

export const membershipRelations = relations(membership, ({ one }) => ({
  organization: one(organization, { fields: [membership.organizationId], references: [organization.id] }),
  user: one(user, { fields: [membership.userId], references: [user.id] }),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, { fields: [project.organizationId], references: [organization.id] }),
  briefs: many(projectBrief),
}));

export const projectBriefRelations = relations(projectBrief, ({ one }) => ({
  project: one(project, { fields: [projectBrief.projectId], references: [project.id] }),
}));

/* ---------- Council sessions (Milestone 2) ---------- */

export const sessionStatus = pgEnum("council_session_status", [
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "failed",
  "awaiting_approval",
  "approved",
  "rejected",
  "changes_requested",
]);

export const councilPhase = pgEnum("council_phase", [
  "independent_thinking",
  "open_council",
  "twelve_minds_council",
  "minority_review",
  "consensus_round",
  "final_verdict",
  "execution_council",
]);

export const decisionMode = pgEnum("decision_mode", ["independent_expert", "adversarial_review", "consensus"]);

export const stageStatus = pgEnum("stage_status", ["pending", "running", "completed", "failed", "skipped", "cancelled", "blocked"]);

/** A council session is one WorkflowRun over a frozen project brief version. */
export const councilSession = pgTable(
  "council_session",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    briefId: text("brief_id")
      .notNull()
      .references(() => projectBrief.id),
    mode: decisionMode("mode").notNull(),
    /** Immutable snapshot of the workflow policy the run was started with. */
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
    policyVersion: integer("policy_version").notNull(),
    /** Version of the prompt templates the run used (packages/council/src/prompts.ts PROMPT_VERSION). */
    promptVersion: text("prompt_version"),
    status: sessionStatus("status").notNull().default("queued"),
    currentPhase: councilPhase("current_phase"),
    tokenBudget: integer("token_budget").notNull(),
    /** Documents frozen into this run's brief. */
    documentIds: jsonb("document_ids").$type<string[]>().notNull().default([]),
    /** Confirmed requirement list the run was started on (#190); fixed for the whole run. Null for runs before #190. */
    requirementListId: text("requirement_list_id").references(() => requirementList.id),
    /**
     * Gate version the run was started for (#181, stage 1b), fixed at creation: a release that supports only lower
     * versions never runs, resumes or re-evaluates it – even before any verdict exists. Releases before this column
     * insert without it and get 1, which is what they compute.
     */
    gateVersion: integer("gate_version").notNull().default(1),
    /** Skill used to set up this council (#363): id, version, content hash and the knowledge text, frozen at the start. */
    skill: jsonb("skill").$type<SkillSessionSnapshot>(),
    /** Role profiles used in this council (#270): id, version, hash and content, frozen at the start. */
    roleProfiles: jsonb("role_profiles").$type<RoleProfileSessionSnapshot[]>(),
    /** Suggested perspectives and where each active role came from (#269), frozen at the start. Null for older runs. */
    roleSelection: jsonb("role_selection").$type<RoleSelectionSnapshot>(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    debateRoundsRun: integer("debate_rounds_run").notNull().default(0),
    error: text("error"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("council_session_org_idx").on(t.organizationId), index("council_session_project_idx").on(t.projectId)],
);

export const participantStatus = pgEnum("participant_status", ["active", "failed"]);

export const councilParticipant = pgTable(
  "council_participant",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    provider: aiProviderId("provider").notNull(),
    modelId: text("model_id").notNull(),
    credentialId: text("credential_id").references(() => aiProviderCredential.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    status: participantStatus("status").notNull().default("active"),
    failureReason: text("failure_reason"),
    /** Weight 1–10 of this model's scores and ranking in the Final Verdict, fixed at the start (#140). */
    voteWeight: integer("vote_weight").notNull().default(1),
    /** The catalog suggestion at the start (#139) – kept next to the weight the user chose. */
    voteWeightSuggestion: jsonb("vote_weight_suggestion").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("participant_session_position_uq").on(t.sessionId, t.position)],
);

/** A 12 Minds Council perspective assigned to a participant model. */
export const councilRoleAssignment = pgTable(
  "council_role_assignment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    participantId: text("participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("role_session_role_uq").on(t.sessionId, t.role)],
);

export const workflowStage = pgTable(
  "workflow_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    phase: councilPhase("phase").notNull(),
    status: stageStatus("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    inputHash: text("input_hash"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("stage_session_phase_uq").on(t.sessionId, t.phase)],
);

export const proposalKind = pgEnum("proposal_kind", ["original", "hybrid"]);

export const proposal = pgTable(
  "proposal",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    authorParticipantId: text("author_participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    kind: proposalKind("kind").notNull().default("original"),
    /** Neutral label ("A", "B", …) assigned in random order at reveal. */
    label: text("label"),
    /** Null until the atomic reveal at the end of Independent Thinking. */
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("proposal_session_idx").on(t.sessionId)],
);

/** Immutable proposal versions; revisions never overwrite earlier content. */
export const proposalRevision = pgTable(
  "proposal_revision",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposal.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    phase: councilPhase("phase").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** For version > 1: what changed and which objections/messages motivated it. */
    changes: jsonb("changes").$type<Record<string, unknown>[]>().notNull().default([]),
    keptPosition: boolean("kept_position").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("revision_proposal_version_uq").on(t.proposalId, t.version)],
);

/** `role_failed`: a 12 Minds role review that failed for good in its round (#175); the body names the error kind. */
export const messageKind = pgEnum("debate_message_kind", [
  "comparison",
  "question",
  "answer",
  "critique",
  "rebuttal",
  "preference",
  "moderator",
  "role_failed",
]);
export const riskCategory = pgEnum("risk_category", ["security", "functional", "performance", "cost", "maintainability", "other"]);
export const severity = pgEnum("severity", ["low", "medium", "high", "critical"]);

export const debateMessage = pgTable(
  "debate_message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    phase: councilPhase("phase").notNull(),
    round: integer("round").notNull().default(1),
    participantId: text("participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    role: text("role"),
    kind: messageKind("kind").notNull(),
    targetProposalId: text("target_proposal_id").references(() => proposal.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    category: riskCategory("category"),
    severity: severity("severity"),
    body: text("body").notNull(),
    evidence: text("evidence").notNull().default(""),
    confidence: integer("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_session_phase_idx").on(t.sessionId, t.phase)],
);

export const objectionStatus = pgEnum("objection_status", ["open", "refuted", "resolved", "accepted", "unresolved"]);

export const minorityObjection = pgTable(
  "minority_objection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id").references(() => debateMessage.id, { onDelete: "set null" }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposal.id, { onDelete: "cascade" }),
    raisedByParticipantId: text("raised_by_participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    category: riskCategory("category").notNull(),
    severity: severity("severity").notNull(),
    claim: text("claim").notNull(),
    evidence: text("evidence").notNull().default(""),
    response: text("response"),
    /** The proposal's author agreed the claim is correct (#94): it can no longer be "refuted". */
    conceded: boolean("conceded").notNull().default(false),
    /**
     * Why the author could not answer (#175), e.g. "provider error (timeout)": its model failed, so the objection is
     * unanswered, not uncontested. Null when the author answered or was never asked.
     */
    undefendedReason: text("undefended_reason"),
    status: objectionStatus("status").notNull().default("open"),
    resolutionReason: text("resolution_reason"),
    reviewedByParticipantId: text("reviewed_by_participant_id").references(() => councilParticipant.id, { onDelete: "set null" }),
    /** True when this objection blocks approval of its proposal (unresolved critical security risk). */
    blocking: boolean("blocking").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("objection_session_idx").on(t.sessionId)],
);

/** Summary records of the Minority Review and Consensus Round stages (separate workflow outputs). */
export const minorityReview = pgTable("minority_review", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => councilSession.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  favoredProposalId: text("favored_proposal_id").references(() => proposal.id, { onDelete: "set null" }),
  majorityModelCount: integer("majority_model_count").notNull().default(0),
  independentModelCount: integer("independent_model_count").notNull().default(0),
  reevaluationTriggered: boolean("reevaluation_triggered").notNull().default(false),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consensusStatus = pgEnum("consensus_status", ["consensus", "partial", "no_consensus"]);

export const consensusResult = pgTable("consensus_result", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => councilSession.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  status: consensusStatus("status").notNull(),
  agreements: jsonb("agreements").$type<string[]>().notNull().default([]),
  disagreements: jsonb("disagreements").$type<string[]>().notNull().default([]),
  outstandingRisks: jsonb("outstanding_risks").$type<string[]>().notNull().default([]),
  hybridProposalId: text("hybrid_proposal_id").references(() => proposal.id, { onDelete: "set null" }),
  /** Proposal revisions the summary was written from, e.g. [{ label: "B", version: 2 }] (#105). */
  basedOn: jsonb("based_on").$type<Array<{ label: string; version: number }>>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evaluationScore = pgTable(
  "evaluation_score",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => proposalRevision.id, { onDelete: "cascade" }),
    evaluatorParticipantId: text("evaluator_participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    criterion: text("criterion").notNull(),
    score: integer("score").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("score_revision_evaluator_criterion_uq").on(t.revisionId, t.evaluatorParticipantId, t.criterion)],
);

export const vote = pgTable(
  "vote",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    evaluatorParticipantId: text("evaluator_participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    /** Proposal ids from best to worst; never contains the evaluator's own proposal. */
    ranking: jsonb("ranking").$type<string[]>().notNull(),
    /** Independent feasibility check per proposal (#121); null for runs before the check existed. */
    requirementChecks: jsonb("requirement_checks").$type<Array<{ proposalId: string; meets: boolean; note: string }>>(),
    /** Proposals whose scores this evaluator gave under another proposal's title; not stored, not ranked (#145). */
    rejectedProposalIds: jsonb("rejected_proposal_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vote_session_evaluator_uq").on(t.sessionId, t.evaluatorParticipantId)],
);

/**
 * Frozen Final Verdict round of a gate-version-2 run (#181, S1): written in one transaction before the first evaluation
 * call and never changed. Resuming after a crash reuses it, so a later dropout never shrinks E(p).
 */
export const evaluationRound = pgTable(
  "evaluation_round",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    requirementListId: text("requirement_list_id")
      .notNull()
      .references(() => requirementList.id),
    /** Requirement ids of that list version, in list order. */
    requirementIds: jsonb("requirement_ids").$type<string[]>().notNull(),
    /** Per proposal: the revision evaluated, its author and E(p) – the participants active at the start, without the author. */
    proposals: jsonb("proposals")
      .$type<Array<{ proposalId: string; revisionId: string; authorParticipantId: string; expectedEvaluatorIds: string[] }>>()
      .notNull(),
    /**
     * #228/#229 follow-up round (owner decision 08.11.26, ADR 0228-0229): "final" for the frozen Final Verdict round 1;
     * "completion" asks an evaluator for checks it left out, "targeted_review" asks it again about its own UNKNOWN
     * checks. A follow-up copies requirement ids and proposals of its parent, appends its own checks and never changes
     * round 1; a FAIL is never asked again and never replaced.
     */
    kind: text("kind").$type<"final" | "completion" | "targeted_review">().notNull().default("final"),
    parentRoundId: text("parent_round_id"),
    /** Follow-up only: exactly the (evaluator, proposal, requirement) items it asks about. */
    items: jsonb("items").$type<Array<{ evaluatorParticipantId: string; proposalId: string; requirementId: string }>>(),
    /** Follow-up only: the extra budget the owner confirmed for it (added to the council's budget). */
    tokenBudget: integer("token_budget"),
    /** Follow-up only: queued → done | failed. */
    status: text("status").$type<"queued" | "done" | "failed">(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("evaluation_round_session_round_uq").on(t.sessionId, t.round)],
);

/**
 * Raw requirement checks of a round (#181, S1), append-only: never updated or deleted, also duplicates and
 * contradictions of one evaluator stay. `valid` is decided when storing (bound to the round's proposals, revisions,
 * requirement ids and expected evaluators); invalid checks are kept for display and never count.
 */
export const requirementCheck = pgTable(
  "requirement_check",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    roundId: text("round_id")
      .notNull()
      .references(() => evaluationRound.id, { onDelete: "cascade" }),
    evaluatorParticipantId: text("evaluator_participant_id")
      .notNull()
      .references(() => councilParticipant.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").notNull(),
    revisionId: text("revision_id").notNull(),
    requirementId: text("requirement_id").notNull(),
    status: text("status").$type<"PASS" | "FAIL" | "UNKNOWN">().notNull(),
    allPartsMet: boolean("all_parts_met"),
    evidence: text("evidence").notNull(),
    /** Measured requirements only: the evaluator's estimated range in the requirement's unit (engine contract 3). */
    estimateLow: doublePrecision("estimate_low"),
    estimateHigh: doublePrecision("estimate_high"),
    valid: boolean("valid").notNull(),
    /** Why a check does not count (e.g. requirement id not in the round); null when valid. */
    invalidReason: text("invalid_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("requirement_check_round_idx").on(t.roundId)],
);

/**
 * needs_verification (#181, stage 1) is only read here, never written by gate version 1: every reader treats it,
 * and any value it does not know, as not approvable. The S1 gate (gate version 2) will write it.
 */
export const verdictOutcome = pgEnum("verdict_outcome", ["recommended", "no_qualifying_solution", "tie", "insufficient_evidence", "needs_verification"]);

export const finalDecision = pgTable("final_decision", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => councilSession.id, { onDelete: "cascade" }),
  /** Set when a human requested more debate and a newer verdict replaced this one. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  outcome: verdictOutcome("outcome").notNull(),
  recommendedProposalId: text("recommended_proposal_id").references(() => proposal.id, { onDelete: "set null" }),
  recommendedRevisionId: text("recommended_revision_id").references(() => proposalRevision.id, { onDelete: "set null" }),
  /** Deterministic aggregation result (see @consyrium/core verdict.ts); reproducible from scores. */
  matrix: jsonb("matrix").$type<Record<string, unknown>>().notNull(),
  /**
   * Format/gate version of this decision (#181), see GATE_VERSION in @consyrium/core: 1 = the feasibility gate of
   * production e33a3bb (also every decision that existed when migration 0021 ran), 2 = S1 gate (later). Nullable on
   * purpose: a release older than stage 1 still writing after the migration leaves it null, and such a decision is
   * never approvable or buildable.
   */
  gateVersion: integer("gate_version"),
  /** Requirement list the verdict was reached on (#190): approval and execution check it against the session's. */
  requirementListId: text("requirement_list_id").references(() => requirementList.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalAction = pgEnum("approval_action", [
  "approve",
  "reject",
  "request_more_debate",
  "request_changes",
  "select_alternative",
  "repeat_evaluation",
  /**
   * #249 part 2 / #478: a person marks a proposal of a needs-verification verdict as favourite – no approval, no build;
   * the session keeps waiting for a decision.
   */
  "mark_favorite",
  /**
   * #249 part 2, owner decision 08.11.26 (variant B): a marked prototype/measurement build of an architecture candidate
   * (or a qualified proposal of a needs-verification verdict) – never a finished solution, never a regular approval.
   */
  "approve_prototype",
  /** #249 gate 2: every open measurement of an architecture candidate was recorded as met – the regular approval. */
  "approve_after_measurement",
]);

export const humanApproval = pgTable("human_approval", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => councilSession.id, { onDelete: "cascade" }),
  decisionId: text("decision_id")
    .notNull()
    .references(() => finalDecision.id, { onDelete: "cascade" }),
  action: approvalAction("action").notNull(),
  selectedProposalId: text("selected_proposal_id").references(() => proposal.id, { onDelete: "set null" }),
  /** Requirement list of the approved verdict (#190); the Execution Council refuses an approval of another list. */
  requirementListId: text("requirement_list_id").references(() => requirementList.id),
  comment: text("comment").notNull().default(""),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageOutcome = pgEnum("usage_outcome", ["ok", "error", "refusal", "invalid_output", "max_tokens"]);

/** One row per model call: the basis for budgets, cost display and metering. */
export const usageRecord = pgTable(
  "usage_record",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => councilSession.id, { onDelete: "cascade" }),
    /** Set for Execution Council calls. */
    planId: text("plan_id"),
    participantId: text("participant_id").references(() => councilParticipant.id, { onDelete: "set null" }),
    phase: councilPhase("phase"),
    provider: aiProviderId("provider").notNull(),
    modelId: text("model_id").notNull(),
    /** All input tokens, including those served from the provider's prompt cache (see TokenUsage in @consyrium/ai). */
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    /** Part of `inputTokens` read from the provider's prompt cache (#244), billed cheaper; 0 for older rows. */
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull(),
    outcome: usageOutcome("outcome").notNull(),
    /**
     * Why a call did not end with "ok" (#175): timeout, rate_limit, overloaded, auth, model_not_found, bad_request,
     * network, credential, schema, mismatch, max_tokens, runaway, refusal. Null for successful calls and older rows.
     */
    errorKind: text("error_kind"),
    /** HTTP status of a failed provider call, when the provider sent one. */
    httpStatus: integer("http_status"),
    /**
     * Null for council and build calls. "intervention" (#15/#41): a model's answer to a human question after the verdict
     * – real cost of the session, but no phase: per-phase and per-model contribution counts leave it out.
     */
    kind: text("kind").$type<"intervention">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_org_created_idx").on(t.organizationId, t.createdAt), index("usage_session_idx").on(t.sessionId)],
);

/* ---------- Durable job queue ---------- */

export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

export const job = pgTable(
  "job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    /** Prevents duplicate jobs for the same purpose (e.g. double-clicked "start"). */
    dedupeKey: text("dedupe_key").unique(),
    /** Workspace the job works for: the worker shares its capacity fairly between workspaces (#149). */
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("job_status_run_at_idx").on(t.status, t.runAt), index("job_org_status_idx").on(t.organizationId, t.status)],
);

/* ---------- Execution Council (Milestone 4) ---------- */

export const executionStatus = pgEnum("execution_status", [
  "queued",
  "planning",
  "awaiting_plan_approval",
  "running",
  "reviewing",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
]);

/** DevelopmentPlan: one Execution Council run for an approved session. */
/** #249 part 2: a regular build of an approved solution, or a marked prototype/measurement build (variant B). */
export const developmentPlanKind = pgEnum("development_plan_kind", ["regular", "prototype"]);

export const developmentPlan = pgTable(
  "development_plan",
  {
    id: text("id").primaryKey(),
    /** prototype: built to measure an open requirement – never a finished solution, never "ready" (#249 part 2). */
    kind: developmentPlanKind("kind").notNull().default("regular"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    approvalId: text("approval_id")
      .notNull()
      .references(() => humanApproval.id),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposal.id),
    plannerParticipantId: text("planner_participant_id")
      .notNull()
      .references(() => councilParticipant.id),
    /** Single builder chosen by the user: plans and writes every task; the other models only review. Null = spread over the council. */
    builderParticipantId: text("builder_participant_id").references(() => councilParticipant.id),
    status: executionStatus("status").notNull().default("queued"),
    /** When true (default), the run stops after planning until an owner/admin approves the plan (#45, #56). */
    requirePlanApproval: boolean("require_plan_approval").notNull().default(true),
    planApprovedAt: timestamp("plan_approved_at", { withTimezone: true }),
    planApprovedById: text("plan_approved_by_id").references(() => user.id, { onDelete: "set null" }),
    planFeedback: text("plan_feedback"),
    /** Planner output: summary, stack, sandbox image, install/test commands. */
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    tokenBudget: integer("token_budget").notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    maxRepairAttempts: integer("max_repair_attempts").notNull().default(2),
    /** Repository base the run started from (null = empty workspace). */
    repositoryFullName: text("repository_full_name"),
    baseBranch: text("base_branch"),
    baseCommitSha: text("base_commit_sha"),
    snapshotSkipped: jsonb("snapshot_skipped").$type<Array<{ path: string; reason: string }>>(),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestUrl: text("pull_request_url"),
    pullRequestCommitSha: text("pull_request_commit_sha"),
    error: text("error"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("plan_session_idx").on(t.sessionId)],
);

export const taskStatus = pgEnum("development_task_status", ["pending", "running", "done", "failed", "skipped", "cancelled"]);

export const developmentTask = pgTable(
  "development_task",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => developmentPlan.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
    assignedParticipantId: text("assigned_participant_id")
      .notNull()
      .references(() => councilParticipant.id),
    status: taskStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("task_plan_key_uq").on(t.planId, t.key)],
);

export const agentExecution = pgTable("agent_execution", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  taskId: text("task_id")
    .notNull()
    .references(() => developmentTask.id, { onDelete: "cascade" }),
  participantId: text("participant_id")
    .notNull()
    .references(() => councilParticipant.id),
  attempt: integer("attempt").notNull(),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Versioned file changes; the latest version per path is the current workspace state. */
export const codeArtifact = pgTable(
  "code_artifact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => developmentPlan.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => developmentTask.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    version: integer("version").notNull(),
    /** "base" (imported repository state, version 0), "write" or "delete". */
    action: text("action").notNull(),
    content: text("content"),
    /** Git file mode for repository files (e.g. 100755). */
    mode: text("mode").notNull().default("100644"),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("artifact_plan_path_version_uq").on(t.planId, t.path, t.version)],
);

export const testRunStatus = pgEnum("test_run_status", ["passed", "failed", "error", "timeout", "not_run"]);

export const testRun = pgTable("test_run", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => developmentPlan.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => developmentTask.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  command: text("command").notNull(),
  sandbox: text("sandbox").notNull(),
  status: testRunStatus("status").notNull(),
  exitCode: integer("exit_code"),
  output: text("output").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const codeReview = pgTable("code_review", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => developmentPlan.id, { onDelete: "cascade" }),
  reviewerParticipantId: text("reviewer_participant_id")
    .notNull()
    .references(() => councilParticipant.id),
  focus: text("focus").notNull(),
  verdict: text("verdict").notNull(),
  findings: jsonb("findings").$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Commercial SaaS (Milestone 6) – platform subscription only, BYOK for AI ---------- */

export const planKey = pgEnum("plan_key", ["starter", "pro", "developer", "business"]);

/** Editable plan catalog (seeded from DEFAULT_PLAN_CATALOG). */
export const planDefinition = pgTable("plan_definition", {
  key: planKey("key").primaryKey(),
  name: text("name").notNull(),
  entitlements: jsonb("entitlements").$type<Record<string, unknown>>().notNull(),
  priceLabel: text("price_label"),
  /** Stripe price used for checkout; null = plan cannot be bought online. */
  stripePriceId: text("stripe_price_id"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

/**
 * Platform-wide settings (one row per key), e.g. the Stripe connection. `secret` holds an encrypted envelope
 * (CREDENTIALS_MASTER_KEY_*); the plaintext never leaves the server and is never shown again.
 */
export const platformSetting = pgTable("platform_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  secret: text("secret"),
  updatedBy: text("updated_by"),
  ...timestamps,
});

export const subscriptionStatus = pgEnum("subscription_status", ["trialing", "active", "past_due", "canceled", "incomplete"]);

export const subscription = pgTable("subscription", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  plan: planKey("plan").notNull(),
  status: subscriptionStatus("status").notNull(),
  /** "manual" (assigned by the platform admin) or "stripe". */
  provider: text("provider").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** Cancelled at Stripe, still paid until currentPeriodEnd (owner request 07.11.26: show "ends on", not "renews on"). */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps,
});

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: orgRole("role").notNull(),
    /** SHA-256 of the invitation token; the token itself is shown once to the inviter. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_org_idx").on(t.organizationId)],
);

/**
 * Optional, organization-entered provider prices used only to show an approximate cost next to
 * observed token usage. The provider's invoice is the source of truth.
 */
export const modelPriceHint = pgTable(
  "model_price_hint",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: aiProviderId("provider").notNull(),
    modelId: text("model_id").notNull(),
    inputPerMillion: text("input_per_million").notNull(),
    outputPerMillion: text("output_per_million").notNull(),
    currency: text("currency").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("price_hint_org_model_uq").on(t.organizationId, t.provider, t.modelId)],
);

/* ---------- Personal API tokens (Milestone 7, VS Code extension and automation) ---------- */

export const apiToken = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** A token acts in exactly one workspace; membership is re-checked on every request. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * "integration": councils only – projects, documents, requirements, start, read, cancel (#101). "full": everything
     * the user may do, including approvals and builds (VS Code extension). Tokens created before #101 are "full".
     */
    scope: text("scope").notNull().default("full"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_token_user_idx").on(t.userId)],
);

/**
 * Idempotency keys for council starts over the API (#101): the same key with the same request returns the same
 * session instead of starting (and paying for) a second one. Kept 24 hours.
 */
export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** sha256 of the route and the request body; another body with the same key is a conflict. */
    requestHash: text("request_hash").notNull(),
    /** Null while the start is in progress. */
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_key_uq").on(t.organizationId, t.userId, t.key)],
);

/* ---------- Model strength catalog (#139) ---------- */

/**
 * One fetch of an external model ranking. Platform-wide (not tenant data): the entries are public ranking data.
 * Failed fetches are kept too, so the admin view shows the last error; the newest successful row is the catalog.
 */
export const modelStrengthSync = pgTable(
  "model_strength_sync",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    entries: jsonb("entries")
      .$type<Array<{ sourceModelId: string; slug: string; name: string; creator: string; creatorSlug?: string; score: number }>>()
      .notNull()
      .default([]),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_strength_sync_ok_fetched_idx").on(t.ok, t.fetchedAt)],
);

/* ---------- Delivery of decisions (#165) ---------- */

export const deliveryKind = pgEnum("delivery_kind", ["telegram", "confluence"]);
export const deliveryTarget = pgEnum("delivery_target", ["email", "telegram", "confluence"]);
export const deliveryStatus = pgEnum("delivery_status", ["sent", "failed"]);

/**
 * A workspace's connection to an outside tool a decision can be sent to. The secret (bot token, API token) is an
 * AES-256-GCM envelope like a provider key and never leaves the server; `config` holds only non-secret settings.
 */
export const deliveryConnection = pgTable(
  "delivery_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: deliveryKind("kind").notNull(),
    label: text("label").notNull(),
    config: jsonb("config").$type<Record<string, string>>().notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    keyVersion: integer("key_version").notNull(),
    secretHint: text("secret_hint").notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    ...timestamps,
  },
  (t) => [uniqueIndex("delivery_connection_org_label_uq").on(t.organizationId, t.kind, t.label)],
);

/**
 * A question sent to the workspace's own Telegram bot (06.11.26): pending until the user taps "Start", then linked to
 * the council it started; "delivered" once the verdict went back to the chat.
 */
export const telegramRequest = pgTable(
  "telegram_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => deliveryConnection.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    requirements: jsonb("requirements").$type<string[]>().notNull(),
    status: text("status").$type<"pending" | "started" | "cancelled" | "delivered" | "failed">().notNull().default("pending"),
    sessionId: text("session_id").references(() => councilSession.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("telegram_request_status_idx").on(t.status, t.updatedAt)],
);

/** Every send of a decision, successful or not (#165): what went where, by whom, with the reason of a failure. */
export const deliveryLog = pgTable(
  "delivery_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    target: deliveryTarget("target").notNull(),
    connectionId: text("connection_id").references(() => deliveryConnection.id, { onDelete: "set null" }),
    /** Who or where, without secrets: e-mail addresses, "Telegram: <label>", "Confluence: <space>". */
    recipient: text("recipient").notNull(),
    status: deliveryStatus("status").notNull(),
    error: text("error"),
    /** Link to the result where the target has one (Confluence page). */
    externalUrl: text("external_url"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("delivery_log_session_idx").on(t.sessionId)],
);

/* ---------- AI assistant (#278–#284) ---------- */

/**
 * A chat with the AI assistant (#280). Private to its user inside one workspace: nobody else – also no admin – reads it.
 * The model runs on the workspace's own key (BYOK); credential and model are stored per chat, never a key.
 */
export const assistantChat = pgTable(
  "assistant_chat",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    credentialId: text("credential_id").references(() => aiProviderCredential.id, { onDelete: "set null" }),
    modelId: text("model_id"),
    /** Optional page context the chat was started from, e.g. a session id. */
    contextKind: text("context_kind"),
    contextId: text("context_id"),
    /**
     * Summary of the earlier part of a long chat (#280), written by a model only when the user asked for it (costs
     * tokens). Messages up to `summaryUntil` are then passed as this summary instead of being dropped.
     */
    summary: text("summary"),
    summaryUntil: timestamp("summary_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assistant_chat_owner_idx").on(t.organizationId, t.userId, t.updatedAt)],
);

/**
 * An action the assistant suggested (#283). `type` is one of the allowed types in repositories/assistant-actions.ts;
 * status moves from "proposed" to "executed" or "dismissed" only by the user's click.
 */
export interface AssistantActionRecord {
  id: string;
  type: string;
  summary: string;
  params: Record<string, unknown>;
  status: "proposed" | "executed" | "dismissed";
  decidedAt?: string;
  /** The user changed the parameters before running it. */
  edited?: boolean;
  /** Link to what the action created or prepared (app-internal path). */
  result?: { label: string; href: string } | null;
}

/** One message of an assistant chat; assistant messages carry model, tools used and token usage. */
export const assistantMessage = pgTable(
  "assistant_message",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => assistantChat.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    /** provider/modelId of an assistant answer. */
    model: text("model"),
    /** Read-only tools the assistant used for this answer (name + arguments), for transparency. */
    tools: jsonb("tools").$type<Array<{ name: string; args: Record<string, unknown> }>>(),
    /** Links to app pages the answer refers to. */
    links: jsonb("links").$type<Array<{ label: string; href: string }>>(),
    /** Actions the assistant suggested with this answer (#283); nothing runs until the user confirms one. */
    actions: jsonb("actions").$type<AssistantActionRecord[]>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** A second opinion (#281): the id of the answer another model checked; null for normal answers. */
    reviewOf: text("review_of"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_message_chat_idx").on(t.chatId, t.createdAt),
    // One second opinion per answer, also for parallel requests (ChatGPT review 08.11.26); NULLs (normal answers) are not unique.
    uniqueIndex("assistant_message_review_of_uq").on(t.reviewOf),
  ],
);

/**
 * Usage ledger of the assistant (ChatGPT review 08.11.26): one row per paid call – answer, second opinion, summary –
 * with its tokens. Not linked to the chat, so deleting a chat (privacy) does not reset the user's limits or the plan's
 * daily question count. Holds no content.
 */
export const assistantUsage = pgTable(
  "assistant_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "answer" counts once per question for the plan quota; further answers of a council chat turn are "council_answer" (#241). */
    kind: text("kind").$type<"answer" | "council_answer" | "second_opinion" | "summary" | "cross_check">().notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_usage_owner_idx").on(t.organizationId, t.userId, t.createdAt),
    index("assistant_usage_org_idx").on(t.organizationId, t.kind, t.createdAt),
  ],
);

/**
 * #15/#41 stage 1 – a human's intervention after the verdict: a question to the council, a request for a statement on
 * an objection, or a mark "important". Kept apart from the debate (council_message), so the council's data, scores,
 * votes, checks and verdict stay exactly as the models produced them. The models' answers are an appendix only.
 */
export const humanIntervention = pgTable(
  "human_intervention",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").$type<"question" | "statement_request" | "mark">().notNull(),
    /** What it refers to: the whole council, one objection or one key dispute (crux id). */
    targetType: text("target_type").$type<"session" | "objection" | "crux">().notNull(),
    targetId: text("target_id"),
    text: text("text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("human_intervention_session_idx").on(t.sessionId, t.createdAt)],
);

/** One model's answer to a human intervention (#15/#41) – never part of the debate or the evaluation. */
export const humanInterventionAnswer = pgTable(
  "human_intervention_answer",
  {
    id: text("id").primaryKey(),
    interventionId: text("intervention_id")
      .notNull()
      .references(() => humanIntervention.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    participantId: text("participant_id").references(() => councilParticipant.id, { onDelete: "set null" }),
    modelId: text("model_id").notNull(),
    body: text("body").notNull(),
    /** Set when the model did not answer (provider error, timeout); `body` is empty then. */
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("human_intervention_answer_idx").on(t.interventionId, t.createdAt)],
);

/**
 * Cross-check in the council chat (#241 stage 2): on the user's click, every other model of the council chat judges one
 * answer – confirmed, contradicted or not checkable – with a short reason. Contradictions stay visible next to the
 * answer; nothing is merged or hidden. Deleted with the chat and the answer. Tokens also go into the usage ledger.
 */
export const assistantCheck = pgTable(
  "assistant_check",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => assistantChat.id, { onDelete: "cascade" }),
    /** The answer (assistant_message) that was checked. */
    messageId: text("message_id")
      .notNull()
      .references(() => assistantMessage.id, { onDelete: "cascade" }),
    /** provider/modelId of the checking model. */
    model: text("model").notNull(),
    verdict: text("verdict").$type<"confirmed" | "contradicted" | "unverifiable">().notNull(),
    reason: text("reason").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assistant_check_chat_idx").on(t.chatId, t.createdAt), uniqueIndex("assistant_check_message_model_uq").on(t.messageId, t.model)],
);

/**
 * Assistant settings of one user in one workspace (#281): the default model, an optional second model that gives a
 * second opinion, and optional token limits per day and per month (only for the assistant; councils have their own
 * budget). Only the user reads and changes them. Keys stay the workspace's own (BYOK).
 */
export const assistantPreference = pgTable(
  "assistant_preference",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").references(() => aiProviderCredential.id, { onDelete: "set null" }),
    modelId: text("model_id"),
    reviewerCredentialId: text("reviewer_credential_id").references(() => aiProviderCredential.id, { onDelete: "set null" }),
    reviewerModelId: text("reviewer_model_id"),
    dailyTokenLimit: integer("daily_token_limit"),
    monthlyTokenLimit: integer("monthly_token_limit"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assistant_preference_owner_uq").on(t.organizationId, t.userId)],
);

/* ---------- Feedback inbox (#295) ---------- */

/**
 * A bug report, feature wish or contact request – from a signed-in user (user_id set) or a visitor (only an e-mail).
 * Platform-wide, read only by the platform admins in /admin; the author sees their own reports and the replies.
 * Deleting the account deletes the user's reports.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    /** Workspace the user was acting in, if any (context for the admin, not an access boundary). */
    organizationId: text("organization_id").references(() => organization.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    kind: text("kind").$type<"bug" | "feature" | "contact">().notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    /** Page the report was sent from (path only), interface language, browser and app version – attached automatically. */
    page: text("page"),
    locale: text("locale"),
    agent: text("agent"),
    appVersion: text("app_version"),
    /** Reserved for the screenshot upload (follow-up of #295); always null for now. */
    screenshot: text("screenshot"),
    state: text("state").$type<"new" | "in_progress" | "done">().notNull().default("new"),
    /**
     * Project or council the report was sent from – only when the user ticked "send this page" (#295 stage 3) and only
     * ids of the user's own workspace. Context for the admin, never an access path.
     */
    context: jsonb("context").$type<{ projectId?: string; sessionId?: string }>(),
    /** When the author last looked at the replies (#295 stage 3): later replies count as unread (badge). */
    replySeenAt: timestamp("reply_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("feedback_state_idx").on(t.state, t.createdAt), index("feedback_user_idx").on(t.userId, t.createdAt)],
);

/** An admin's answer to a feedback report; shown to the author under "My reports". */
export const feedbackReply = pgTable(
  "feedback_reply",
  {
    id: text("id").primaryKey(),
    feedbackId: text("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    adminId: text("admin_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_reply_feedback_idx").on(t.feedbackId, t.createdAt)],
);

/* ---------- Skills (#363): shareable decision packages ---------- */

export const skillVisibility = pgEnum("skill_visibility", ["private", "team"]);
/** SkillHub content type (#368): decision skills and expert profiles share the hub pipeline. */
export const hubKind = pgEnum("hub_kind", ["skill", "role_profile"]);
export const skillReviewStatus = pgEnum("skill_review_status", ["draft", "scanning", "pending_review", "published", "rejected", "quarantined", "withdrawn"]);

/** A skill of a workspace. Content lives in immutable versions; a council stores id + version + content hash. */
export const skill = pgTable(
  "skill",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The author; only they see a private skill. */
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What the versions contain (HubKind): a decision skill or an expert profile submitted to the SkillHub. */
    kind: hubKind("kind").notNull().default("skill"),
    /** For kinds that mirror another workspace object (an expert profile): its id. Null for decision skills. */
    sourceId: text("source_id"),
    visibility: skillVisibility("visibility").notNull().default("private"),
    latestVersion: integer("latest_version").notNull().default(1),
    /** Where a duplicated skill came from (#422): source id, version and content hash at the time of the copy. */
    forkedFrom: jsonb("forked_from").$type<SkillForkRef>(),
    /** Archived skills stay readable for councils that used them, but are no longer offered. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * SkillHub (#368): the version that is public (reviewed and approved), or null. Edits create new versions that stay
     * private until they pass their own review – the public page always shows this version.
     */
    publicVersion: integer("public_version"),
    /** Public URL part `@handle/slug`; unique per publisher. Set on the first submission. */
    slug: text("slug"),
    /** Shown in the public catalog and search. Unlisted skills are reachable by link only – no access control. */
    listed: boolean("listed").notNull().default(true),
    /** Hidden by a moderator (never automatically by reports); the author still sees it and the reason. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenReason: text("hidden_reason"),
    ...timestamps,
  },
  (t) => [
    index("skill_org_idx").on(t.organizationId),
    index("skill_owner_idx").on(t.ownerUserId),
    uniqueIndex("skill_owner_slug_uq").on(t.ownerUserId, t.slug),
    uniqueIndex("skill_kind_source_uq").on(t.kind, t.sourceId),
    index("skill_public_idx").on(t.publicVersion),
  ],
);

export const skillVersion = pgTable(
  "skill_version",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Validated SkillContent (@consyrium/core). */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** sha256 of the canonical JSON (skillContentHash). */
    contentHash: text("content_hash").notNull(),
    /** Optional short note on what changed in this version (#422); not part of the content or its hash. */
    changelog: text("changelog"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** SkillHub review state (SKILL_REVIEW_STATUSES in @consyrium/core). Only `published` is public. */
    reviewStatus: skillReviewStatus("review_status").notNull().default("draft"),
    /** Static publication scan (scanSkillForPublication) incl. its rules version – the light an approval is bound to. */
    scanResult: jsonb("scan_result").$type<PublicationScanResult>(),
    /** Model review: light, reasons per field, reviewer model/prompt version, tokens used. */
    aiReview: jsonb("ai_review").$type<Record<string, unknown>>(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Licence the author accepted for this version (SKILL_PUBLICATION_LICENSE.id) and when. */
    license: text("license"),
    licenseAcceptedAt: timestamp("license_accepted_at", { withTimezone: true }),
    reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Reason shown to the author on reject, quarantine or withdrawal. */
    reviewNote: text("review_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("skill_version_uq").on(t.skillId, t.version), index("skill_version_review_idx").on(t.reviewStatus)],
);

/** A SkillHub publisher: the handle in `@handle/slug` belongs to one account. Suspension blocks new submissions. */
export const skillPublisher = pgTable("skill_publisher", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  /** Optional public name shown next to @handle (checked like skill texts; reserved names only for platform admins). */
  displayName: text("display_name"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  ...timestamps,
});

export const skillReportReason = pgEnum("skill_report_reason", ["misleading", "injection", "personal_data", "impersonation", "spam", "copyright", "other"]);
export const skillReportStatus = pgEnum("skill_report_status", ["open", "resolved", "dismissed"]);

/** A report on a public skill. Goes to the admin queue; reports never change visibility on their own. */
export const skillReport = pgTable(
  "skill_report",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    reporterUserId: text("reporter_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: skillReportReason("reason").notNull(),
    note: text("note"),
    status: skillReportStatus("status").notNull().default("open"),
    resolvedById: text("resolved_by_id").references(() => user.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("skill_report_reporter_uq").on(t.skillId, t.reporterUserId), index("skill_report_status_idx").on(t.status, t.createdAt)],
);

/** Audit log of every SkillHub review and moderation step (actor null = the system, e.g. scan or auto-approval). */
export const skillModerationLog = pgTable(
  "skill_moderation_log",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    version: integer("version"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    /** SKILL_MODERATION_ACTIONS in @consyrium/core. */
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** Light, reason, content hash and rules version at the time – never secrets. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("skill_moderation_log_skill_idx").on(t.skillId, t.createdAt)],
);

/* ---------- Expert Library, stage 1 (#270): role profiles for the 12 Minds roles ---------- */

export const roleProfileVisibility = pgEnum("role_profile_visibility", ["private", "team"]);

/** A workspace's profile for one existing 12 Minds role. Content lives in immutable versions. */
export const roleProfile = pgTable(
  "role_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The author; only they see a private profile. */
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The 12 Minds role (CouncilRole) of the latest version. */
    role: text("role").notNull(),
    name: text("name").notNull(),
    visibility: roleProfileVisibility("visibility").notNull().default("private"),
    latestVersion: integer("latest_version").notNull().default(1),
    /** Origin of a profile adopted from the SkillHub (#368): hub skill id, version, content hash, `@handle/slug`. */
    forkedFrom: jsonb("forked_from").$type<SkillForkRef>(),
    /** Deactivated profiles stay readable for councils that used them, but are no longer offered. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("role_profile_org_idx").on(t.organizationId), index("role_profile_owner_idx").on(t.ownerUserId)],
);

export const roleProfileVersion = pgTable(
  "role_profile_version",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => roleProfile.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Validated RoleProfileContent (@consyrium/core). */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    /** sha256 of the canonical JSON (roleProfileContentHash). */
    contentHash: text("content_hash").notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("role_profile_version_uq").on(t.profileId, t.version)],
);

/**
 * #249 gate 2 – acceptance by measurement (owner decision 08.11.26). Append-only: a person with the approval role states
 * the measured result of one measurement-check requirement of one proposal, with mandatory evidence. A self-declaration,
 * shown everywhere as such ("Measurement: self-declared by <person>, evidence: …"); only the latest entry per proposal
 * and requirement counts. Recorded only from a signed-in session, never through an API token, MCP or an agent.
 */
export const measurementResult = pgTable(
  "measurement_result",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => councilSession.id, { onDelete: "cascade" }),
    decisionId: text("decision_id")
      .notNull()
      .references(() => finalDecision.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposal.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id").notNull(),
    /** The prototype/measurement build the value was measured on, if any. */
    planId: text("plan_id").references(() => developmentPlan.id, { onDelete: "set null" }),
    method: text("method").notNull(),
    target: text("target").notNull(),
    measured: text("measured").notNull(),
    met: boolean("met").notNull(),
    evidence: text("evidence").notNull(),
    recordedById: text("recorded_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("measurement_result_session_idx").on(t.sessionId, t.proposalId, t.requirementId)],
);

/** #201: what a plan-usage entry counts – a council start, a build start, or sandbox time in milliseconds. */
export const planUsageKind = pgEnum("plan_usage_kind", ["session", "execution", "sandbox_ms"]);

/**
 * #201 – plan usage ledger (append-only). Monthly limits are counted here, not from the councils, builds and test runs
 * that still exist: deleting a project, a session or a build must not give back a month's runs. Holds no content – no
 * brief, prompt, report, key or code – only the workspace, the kind, the amount and the id of the run it was booked for
 * (`refId`, unique per kind, so a retry never books twice). A refund is a negative entry with its own refId. Deleted
 * with the workspace; projects and sessions are not referenced, so deleting them leaves the ledger as it is.
 */
export const planUsage = pgTable(
  "plan_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: planUsageKind("kind").notNull(),
    amount: integer("amount").notNull(),
    refId: text("ref_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plan_usage_ref_uq").on(t.organizationId, t.kind, t.refId), index("plan_usage_month_idx").on(t.organizationId, t.kind, t.createdAt)],
);

/**
 * ADR 0206 (#206): ids of permanently deleted workspaces, projects and sessions – never names, content or the deleting
 * user. The deletion list outside the database backups (DELETIONS_LOG) is the source for the post-restore scrub; this
 * table is the second copy that restore.sh exports into that list before it restores an older dump. No foreign keys:
 * the rows outlive what they name.
 */
export const deletionTombstone = pgTable(
  "deletion_tombstone",
  {
    kind: text("kind").$type<"workspace" | "project" | "session">().notNull(),
    entityId: text("entity_id").notNull(),
    organizationId: text("organization_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.entityId] })],
);

/**
 * OAuth sign-in for MCP clients and the Obsidian plugin (docs/mcp.md, migration 0057): clients registered through
 * `POST /api/oauth/register` (RFC 7591). Public clients only – there is no client secret; PKCE proves that the party
 * redeeming a code is the one that asked for it. Platform data without a workspace: registration is open, the consent
 * page shows the redirect target. First-party clients (the Obsidian plugin) are built in and have no row here.
 */
export const oauthClient = pgTable("oauth_client", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-time authorization codes of the OAuth sign-in: created when the signed-in user allows a client, redeemed once at
 * `POST /api/oauth/token` for an ordinary `api_token`. Only the sha256 of the code is stored; a code lives two minutes
 * and is consumed by the first exchange attempt, successful or not. `client_id` is the public client id (no foreign
 * key: built-in clients have no `oauth_client` row).
 */
export const oauthCode = pgTable(
  "oauth_code",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE S256 challenge: base64url(sha256(code_verifier)). */
    codeChallenge: text("code_challenge").notNull(),
    /** API token scope the code turns into: "integration" (OAuth scope "councils") or "read". */
    scope: text("scope").$type<"integration" | "read">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_code_expires_idx").on(t.expiresAt)],
);
