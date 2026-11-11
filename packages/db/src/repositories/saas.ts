import {
  DEFAULT_PLAN,
  DEFAULT_PLAN_CATALOG,
  DomainError,
  isSelfHosted,
  isUnlimited,
  SELF_HOSTED_ENTITLEMENTS,
  UNLIMITED,
  validateEntitlements,
  type Entitlements,
  type PlanKey,
} from "@consyrium/core";
import { and, asc, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  assistantUsage,
  councilSession,
  developmentPlan,
  invitation,
  membership,
  organization,
  planDefinition,
  planUsage,
  project,
  subscription,
  usageRecord,
  user,
} from "../schema";
import { newId } from "../ids";
import { recordAudit } from "./audit";

/** Plan catalog; seeded from the defaults on first use so the admin can edit it afterwards. */
export async function getPlanCatalog(db: Database) {
  const rows = await db.select().from(planDefinition).orderBy(asc(planDefinition.createdAt));
  if (rows.length > 0) return rows.map(withDefaultEntitlements);
  await db
    .insert(planDefinition)
    .values(
      DEFAULT_PLAN_CATALOG.map((p) => ({
        key: p.key,
        name: p.name,
        entitlements: p.entitlements as unknown as Record<string, unknown>,
        priceLabel: p.priceLabel,
      })),
    )
    .onConflictDoNothing();
  return (await db.select().from(planDefinition).orderBy(asc(planDefinition.createdAt))).map(withDefaultEntitlements);
}

/**
 * Rows stored before an entitlement existed (e.g. `mcp`, 06.11.26) get the catalog default for that plan, so a new
 * feature has a defined value without a data migration and shows up in the admin editor.
 */
function withDefaultEntitlements<T extends { key: string; entitlements: Record<string, unknown> }>(row: T): T {
  const defaults = DEFAULT_PLAN_CATALOG.find((p) => p.key === row.key)?.entitlements ?? DEFAULT_PLAN_CATALOG[0]!.entitlements;
  return { ...row, entitlements: { ...defaults, ...row.entitlements } };
}

export async function updatePlanDefinition(
  db: Database,
  adminUserId: string,
  key: PlanKey,
  data: { name: string; entitlements: Entitlements; priceLabel: string | null; stripePriceId: string | null; active: boolean },
) {
  const errors = validateEntitlements(data.entitlements);
  if (errors.length) throw new DomainError("VALIDATION", errors.join("; "));
  await getPlanCatalog(db);
  await db
    .update(planDefinition)
    .set({ ...data, entitlements: data.entitlements as unknown as Record<string, unknown> })
    .where(eq(planDefinition.key, key));
  await recordAudit(db, { organizationId: null, actorUserId: adminUserId, action: "admin.plan_updated", targetType: "plan", targetId: key });
}

export async function getSubscription(db: Database, organizationId: string) {
  const [row] = await db.select().from(subscription).where(eq(subscription.organizationId, organizationId));
  return (
    row ?? {
      organizationId,
      plan: DEFAULT_PLAN as PlanKey,
      status: "active" as const,
      provider: "default",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }
  );
}

/** Effective entitlements: an inactive paid subscription falls back to the default plan; self-hosted has no limits. */
export async function getEntitlements(db: Database, organizationId: string): Promise<{ plan: PlanKey; entitlements: Entitlements }> {
  if (isSelfHosted()) return { plan: "business", entitlements: SELF_HOSTED_ENTITLEMENTS };
  const sub = await getSubscription(db, organizationId);
  const active = sub.status === "active" || sub.status === "trialing";
  const key = active ? sub.plan : DEFAULT_PLAN;
  const catalog = await getPlanCatalog(db);
  const plan = catalog.find((p) => p.key === key) ?? catalog.find((p) => p.key === DEFAULT_PLAN)!;
  return { plan: plan.key, entitlements: plan.entitlements as unknown as Entitlements };
}

export async function setSubscriptionPlan(db: Database, adminUserId: string, organizationId: string, plan: PlanKey) {
  // An unknown organization is a 404, not a foreign key error surfacing as 500 (#183).
  const [org] = await db.select({ id: organization.id }).from(organization).where(eq(organization.id, organizationId));
  if (!org) throw new DomainError("NOT_FOUND", "Organization not found");
  await db
    .insert(subscription)
    .values({ organizationId, plan, status: "active", provider: "manual" })
    .onConflictDoUpdate({ target: subscription.organizationId, set: { plan, status: "active", provider: "manual" } });
  await recordAudit(db, {
    organizationId,
    actorUserId: adminUserId,
    action: "admin.plan_assigned",
    targetType: "subscription",
    targetId: organizationId,
    metadata: { plan },
  });
}

/** Applied from verified Stripe webhooks. */
export async function upsertStripeSubscription(
  db: Database,
  data: {
    organizationId: string;
    plan: PlanKey;
    status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd?: boolean;
  },
) {
  data = { ...data, cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false };
  await db
    .insert(subscription)
    .values({ ...data, provider: "stripe" })
    .onConflictDoUpdate({ target: subscription.organizationId, set: { ...data, provider: "stripe" } });
  await recordAudit(db, {
    organizationId: data.organizationId,
    actorUserId: null,
    action: "billing.subscription_updated",
    targetType: "subscription",
    targetId: data.organizationId,
    metadata: { plan: data.plan, status: data.status, cancelAtPeriodEnd: data.cancelAtPeriodEnd },
  });
}

/**
 * The stored Stripe customer does not exist in the connected Stripe account (test-mode customer after switching to live
 * keys). The ids are forgotten so checkout can create a new customer; plan and status stay as they are and the
 * subscription counts as manually assigned, because there is nothing to manage at Stripe.
 */
export async function forgetStripeCustomer(db: Database, organizationId: string, actorUserId: string | null) {
  await db
    .update(subscription)
    .set({ stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, provider: "manual" })
    .where(eq(subscription.organizationId, organizationId));
  await recordAudit(db, {
    organizationId,
    actorUserId,
    action: "billing.stale_stripe_customer_forgotten",
    targetType: "subscription",
    targetId: organizationId,
  });
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Platform usage this calendar month (UTC) plus observed AI token usage per model. Token figures
 * are transparency only – customers pay their AI provider directly (BYOK).
 */
export async function usageThisMonth(db: Database, organizationId: string) {
  const since = monthStart();
  const [members] = await db.select({ n: count() }).from(membership).where(eq(membership.organizationId, organizationId));
  const [pendingInvites] = await db
    .select({ n: count() })
    .from(invitation)
    .where(
      and(eq(invitation.organizationId, organizationId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gte(invitation.expiresAt, new Date())),
    );
  const [projects] = await db
    .select({ n: count() })
    .from(project)
    // The read-only demo project never counts against the plan (owner decision 08.11.26).
    .where(and(eq(project.organizationId, organizationId), sql`${project.status} not in ('archived', 'deleting')`, eq(project.isDemo, false)));
  // #201: counted from the plan usage ledger – deleting projects, sessions or builds gives back no monthly runs.
  const booked = await monthlyPlanUsage(db, organizationId, since);
  const models = await db
    .select({
      provider: usageRecord.provider,
      modelId: usageRecord.modelId,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::int`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageRecord.cachedInputTokens}), 0)::int`,
      failed: sql<number>`count(*) filter (where ${usageRecord.outcome} <> 'ok')::int`,
    })
    .from(usageRecord)
    .where(and(eq(usageRecord.organizationId, organizationId), gte(usageRecord.createdAt, since)))
    .groupBy(usageRecord.provider, usageRecord.modelId);
  return {
    since,
    members: members!.n,
    pendingInvitations: pendingInvites!.n,
    projects: projects!.n,
    sessions: booked.session,
    executions: booked.execution,
    sandboxMinutes: Math.ceil(booked.sandbox_ms / 60_000),
    models,
  };
}

/** #201: the ledger's totals since `since` per kind (refunds are negative entries). */
async function monthlyPlanUsage(db: Database, organizationId: string, since: Date) {
  const rows = await db
    .select({ kind: planUsage.kind, total: sql<number>`coalesce(sum(${planUsage.amount}), 0)::int` })
    .from(planUsage)
    .where(and(eq(planUsage.organizationId, organizationId), gte(planUsage.createdAt, since)))
    .groupBy(planUsage.kind);
  const total = (kind: (typeof rows)[number]["kind"]) => Math.max(0, Number(rows.find((r) => r.kind === kind)?.total ?? 0));
  return { session: total("session"), execution: total("execution"), sandbox_ms: total("sandbox_ms") };
}

/**
 * #201: books one council or build start on the plan usage ledger, inside the caller's transaction. The workspace row
 * is locked first, so concurrent starts on the last free slot are serialised: the second one sees the first booking
 * and is refused. Idempotent per run id – a retry of the same start books nothing twice.
 */
export async function consumeMonthlyRun(tx: Database, organizationId: string, kind: "session" | "execution", refId: string): Promise<void> {
  await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, organizationId)).for("update");
  const [already] = await tx
    .select({ id: planUsage.id })
    .from(planUsage)
    .where(and(eq(planUsage.organizationId, organizationId), eq(planUsage.kind, kind), eq(planUsage.refId, refId)));
  if (already) return;
  const { plan, entitlements: e } = await getEntitlements(tx, organizationId);
  const limit = kind === "session" ? e.maxSessionsPerMonth : e.maxExecutionsPerMonth;
  const used = (await monthlyPlanUsage(tx, organizationId, monthStart()))[kind];
  if (!isUnlimited(limit) && used >= limit)
    throw new DomainError(
      "FORBIDDEN",
      `${kind === "session" ? `Your plan allows ${limit} council session(s) per month` : `Your plan allows ${limit} Execution Council run(s) per month`} (plan: ${plan}). Upgrade under Settings → Billing.`,
    );
  await tx.insert(planUsage).values({ id: newId("plu"), organizationId, kind, amount: 1, refId });
}

/** #201: books sandbox time of one test run (milliseconds). Idempotent per test run id. */
export async function recordSandboxUsage(db: Database, organizationId: string, testRunId: string, durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await db
    .insert(planUsage)
    .values({ id: newId("plu"), organizationId, kind: "sandbox_ms", amount: Math.round(durationMs), refId: testRunId })
    .onConflictDoNothing();
}

/**
 * #201 refund policy: a council stopped before its first model call gives its slot back – one negative entry, once.
 * Anything that already called a model stays counted (the provider has billed the user's own key anyway).
 */
export async function refundMonthlyRun(db: Database, organizationId: string, kind: "session" | "execution", refId: string): Promise<void> {
  await db
    .insert(planUsage)
    .values({ id: newId("plu"), organizationId, kind, amount: -1, refId: `${refId}:refund` })
    .onConflictDoNothing();
}

export type LimitCheck = "member" | "project" | "session" | "execution" | "github" | "mcp" | "assistant";

/** Server-side plan gate; throws with a clear upgrade message. */
export async function assertEntitlement(db: Database, organizationId: string, check: LimitCheck, extra: { participants?: number } = {}) {
  const { plan, entitlements: e } = await getEntitlements(db, organizationId);
  const usage = await usageThisMonth(db, organizationId);
  const fail = (message: string) => {
    throw new DomainError("FORBIDDEN", `${message} (plan: ${plan}). Upgrade under Settings → Billing.`);
  };
  switch (check) {
    case "member":
      if (usage.members + usage.pendingInvitations >= e.maxMembers) fail(`Your plan allows ${e.maxMembers} member(s)`);
      break;
    case "project":
      if (usage.projects >= e.maxProjects) fail(`Your plan allows ${e.maxProjects} active project(s)`);
      break;
    case "session":
      if (usage.sessions >= e.maxSessionsPerMonth) fail(`Your plan allows ${e.maxSessionsPerMonth} council session(s) per month`);
      if ((extra.participants ?? 0) > e.maxParticipantsPerSession) fail(`Your plan allows ${e.maxParticipantsPerSession} models per session`);
      break;
    case "execution":
      if (!e.executionCouncil) fail("The Execution Council is not included in your plan");
      if (usage.executions >= e.maxExecutionsPerMonth) fail(`Your plan allows ${e.maxExecutionsPerMonth} Execution Council run(s) per month`);
      if (e.maxSandboxMinutesPerMonth > 0 && usage.sandboxMinutes >= e.maxSandboxMinutesPerMonth) fail("The monthly sandbox time of your plan is used up");
      break;
    case "github":
      if (!e.github) fail("The GitHub integration is not included in your plan");
      break;
    case "mcp":
      if (!e.mcp) fail("The MCP server is included in Pro");
      break;
    case "assistant": {
      // #281: answered questions of the whole workspace since 00:00 UTC, from the usage ledger – deleting a chat does not
      // reset it, a failed answer does not count, second opinions and summaries are not questions.
      const limit = e.maxAssistantQuestionsPerDay ?? UNLIMITED;
      if (isUnlimited(limit)) break;
      const now = new Date();
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const [row] = await db
        .select({ n: count() })
        .from(assistantUsage)
        .where(and(eq(assistantUsage.organizationId, organizationId), eq(assistantUsage.kind, "answer"), gte(assistantUsage.createdAt, since)));
      if (Number(row?.n ?? 0) >= limit) fail(`Your plan allows ${limit} assistant question(s) per day for the workspace`);
      break;
    }
  }
}

/** Platform admin overview (caller must be a platform admin). */
export async function platformOverview(db: Database) {
  const [[users], [orgs], [sessionCount], [runCount]] = await Promise.all([
    db.select({ n: count() }).from(user),
    db.select({ n: count() }).from(organization),
    db.select({ n: count() }).from(councilSession),
    db.select({ n: count() }).from(developmentPlan),
  ]);
  const organizations = await db
    .select({
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt,
      members: sql<number>`(select count(*) from "membership" m where m.organization_id = "organization"."id")::int`,
    })
    .from(organization)
    .orderBy(sql`${organization.createdAt} desc`)
    .limit(100);
  return { users: users!.n, organizations: orgs!.n, sessions: sessionCount!.n, executions: runCount!.n, list: organizations };
}
