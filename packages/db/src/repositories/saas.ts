import { DEFAULT_PLAN, DEFAULT_PLAN_CATALOG, DomainError, isSelfHosted, SELF_HOSTED_ENTITLEMENTS, validateEntitlements, type Entitlements, type PlanKey } from "@consyrion/core";
import { and, asc, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { councilSession, developmentPlan, invitation, membership, organization, planDefinition, project, subscription, testRun, usageRecord, user } from "../schema";
import { recordAudit } from "./audit";

/** Plan catalog; seeded from the defaults on first use so the admin can edit it afterwards. */
export async function getPlanCatalog(db: Database) {
  const rows = await db.select().from(planDefinition).orderBy(asc(planDefinition.createdAt));
  if (rows.length > 0) return rows;
  await db
    .insert(planDefinition)
    .values(DEFAULT_PLAN_CATALOG.map((p) => ({ key: p.key, name: p.name, entitlements: p.entitlements as unknown as Record<string, unknown>, priceLabel: p.priceLabel })))
    .onConflictDoNothing();
  return db.select().from(planDefinition).orderBy(asc(planDefinition.createdAt));
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
  return row ?? { organizationId, plan: DEFAULT_PLAN as PlanKey, status: "active" as const, provider: "default", stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null };
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
  await recordAudit(db, { organizationId, actorUserId: adminUserId, action: "admin.plan_assigned", targetType: "subscription", targetId: organizationId, metadata: { plan } });
}

/** Applied from verified Stripe webhooks. */
export async function upsertStripeSubscription(
  db: Database,
  data: { organizationId: string; plan: PlanKey; status: "trialing" | "active" | "past_due" | "canceled" | "incomplete"; stripeCustomerId: string; stripeSubscriptionId: string; currentPeriodEnd: Date | null },
) {
  await db
    .insert(subscription)
    .values({ ...data, provider: "stripe" })
    .onConflictDoUpdate({ target: subscription.organizationId, set: { ...data, provider: "stripe" } });
  await recordAudit(db, { organizationId: data.organizationId, actorUserId: null, action: "billing.subscription_updated", targetType: "subscription", targetId: data.organizationId, metadata: { plan: data.plan, status: data.status } });
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
    .where(and(eq(invitation.organizationId, organizationId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gte(invitation.expiresAt, new Date())));
  const [projects] = await db.select({ n: count() }).from(project).where(and(eq(project.organizationId, organizationId), sql`${project.status} <> 'archived'`));
  const [sessions] = await db.select({ n: count() }).from(councilSession).where(and(eq(councilSession.organizationId, organizationId), gte(councilSession.createdAt, since)));
  const [executions] = await db.select({ n: count() }).from(developmentPlan).where(and(eq(developmentPlan.organizationId, organizationId), gte(developmentPlan.createdAt, since)));
  const [sandbox] = await db
    .select({ ms: sql<number>`coalesce(sum(${testRun.durationMs}), 0)::int` })
    .from(testRun)
    .where(and(eq(testRun.organizationId, organizationId), gte(testRun.createdAt, since), sql`${testRun.status} <> 'not_run'`));
  const models = await db
    .select({
      provider: usageRecord.provider,
      modelId: usageRecord.modelId,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageRecord.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecord.outputTokens}), 0)::int`,
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
    sessions: sessions!.n,
    executions: executions!.n,
    sandboxMinutes: Math.ceil((sandbox?.ms ?? 0) / 60_000),
    models,
  };
}

export type LimitCheck = "member" | "project" | "session" | "execution" | "github";

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
    .select({ id: organization.id, name: organization.name, createdAt: organization.createdAt, members: sql<number>`(select count(*) from "membership" m where m.organization_id = "organization"."id")::int` })
    .from(organization)
    .orderBy(sql`${organization.createdAt} desc`)
    .limit(100);
  return { users: users!.n, organizations: orgs!.n, sessions: sessionCount!.n, executions: runCount!.n, list: organizations };
}
