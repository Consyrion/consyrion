import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError, PLAN_KEYS, type PlanKey } from "@consyrium/core";
import { getPlanCatalog, upsertStripeSubscription, type Database } from "@consyrium/db";

/**
 * Stripe billing for the platform subscription only. Consyrium never charges for AI usage (BYOK,
 * issue #30). Without STRIPE_SECRET_KEY nothing here is reachable and nothing is charged.
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Customer portal configuration created by the admin setup; absent = Stripe's default configuration. */
  portalConfigurationId?: string;
}

export function stripeConfigFromEnv(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  return env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET } : null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function form(data: Record<string, string>) {
  return new URLSearchParams(data).toString();
}

export class StripeClient {
  constructor(
    private readonly config: StripeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, data?: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.secretKey}`, ...(data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: data ? form(data) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string; param?: string } };
    if (!response.ok) {
      // Stripe's message never contains the secret key; it tells the admin what to fix (e.g. "Invalid API Key").
      const detail = json.error?.message ? `: ${json.error.message.slice(0, 200)}` : "";
      throw new DomainError("PROVIDER_ERROR", `Stripe request failed (${response.status})${detail}`, {
        stripeCode: json.error?.code ?? null,
        stripeParam: json.error?.param ?? null,
      });
    }
    return json;
  }

  /** Current state of a subscription (#407: webhooks apply this instead of the possibly stale event snapshot). */
  retrieveSubscription(id: string) {
    if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new DomainError("VALIDATION", "Invalid subscription id");
    return this.request<StripeSubscriptionObject>("GET", `/v1/subscriptions/${id}`);
  }

  createCheckoutSession(input: {
    priceId: string;
    organizationId: string;
    plan: PlanKey;
    customerEmail: string;
    customerId?: string | null;
    successUrl: string;
    cancelUrl: string;
  }) {
    return this.request<{ id: string; url: string }>("POST", "/v1/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": input.priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: input.organizationId,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      ...(input.customerId ? { customer: input.customerId } : { customer_email: input.customerEmail }),
      "subscription_data[metadata][organizationId]": input.organizationId,
      "subscription_data[metadata][plan]": input.plan,
      "metadata[organizationId]": input.organizationId,
    });
  }

  /**
   * Stripe's customer portal. With `cancelSubscriptionId` it opens directly at the cancellation step of that
   * subscription ("back to Free", 08.11.26); the portal configuration cancels at the period end (setup.ts) and returns
   * to `returnUrl` afterwards.
   */
  createPortalSession(customerId: string, returnUrl: string, options: { cancelSubscriptionId?: string | null } = {}) {
    return this.request<{ url: string }>("POST", "/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: returnUrl,
      ...(this.config.portalConfigurationId ? { configuration: this.config.portalConfigurationId } : {}),
      ...(options.cancelSubscriptionId
        ? {
            "flow_data[type]": "subscription_cancel",
            "flow_data[subscription_cancel][subscription]": options.cancelSubscriptionId,
            "flow_data[after_completion][type]": "redirect",
            "flow_data[after_completion][redirect][return_url]": returnUrl,
          }
        : {}),
    });
  }
}

/** Verifies the Stripe-Signature header (t=…,v1=…) with a tolerance against replay. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > toleranceSeconds || signatures.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex"));
  return signatures.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

interface StripeSubscriptionObject {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  /** Cancelled in the portal ("at period end"): still paid and usable until current_period_end. */
  cancel_at_period_end?: boolean;
  /** Set when a cancellation is scheduled (also for "cancel at a date"). */
  cancel_at?: number | null;
  metadata?: { organizationId?: string; plan?: string };
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

const STATUS_MAP: Record<string, "trialing" | "active" | "past_due" | "canceled" | "incomplete"> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "past_due",
};

/**
 * Applies a verified webhook event. Unknown events are ignored.
 *
 * Stripe neither guarantees the order of events nor delivers them only once (#407): a late or retried
 * `customer.subscription.updated` (status active) arriving after `…deleted` would reactivate a cancelled plan. With
 * `fetchCurrent` the handler applies the subscription's **current** state from the Stripe API instead of the snapshot
 * in the event – any order and any number of deliveries then end in the same, latest state.
 */
export async function handleStripeEvent(
  db: Database,
  event: { type: string; data: { object: unknown } },
  options: { fetchCurrent?: (subscriptionId: string) => Promise<StripeSubscriptionObject> } = {},
) {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return { handled: false };
  const snapshot = event.data.object as StripeSubscriptionObject;
  const sub = options.fetchCurrent && snapshot.id ? await options.fetchCurrent(snapshot.id) : snapshot;
  // Ended means ended: by the event type when applying the snapshot, by the current status when it was fetched.
  const ended = options.fetchCurrent ? sub.status === "canceled" || sub.status === "incomplete_expired" : event.type === "customer.subscription.deleted";
  const organizationId = sub.metadata?.organizationId;
  if (!organizationId) return { handled: false };
  const catalog = await getPlanCatalog(db);
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planFromPrice = catalog.find((p) => p.stripePriceId && p.stripePriceId === priceId)?.key;
  const planFromMeta = PLAN_KEYS.find((k) => k === sub.metadata?.plan);
  const plan = planFromPrice ?? planFromMeta;
  if (!plan) return { handled: false };
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  await upsertStripeSubscription(db, {
    organizationId,
    plan,
    status: ended ? "canceled" : (STATUS_MAP[sub.status] ?? "incomplete"),
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    // Cancelled but paid until the period end: the plan stays until Stripe sends customer.subscription.deleted.
    cancelAtPeriodEnd: !ended && (sub.cancel_at_period_end === true || Boolean(sub.cancel_at)),
  });
  return { handled: true };
}

export * from "./setup";

/**
 * Stripe does not know the stored customer – typically a customer of the test mode after switching to live keys (owner
 * report 07.11.26: "No such customer: 'cus_…'" on "Manage subscription").
 */
export function isMissingStripeCustomer(error: unknown): boolean {
  if (!(error instanceof DomainError)) return false;
  const details = (error.details ?? {}) as { stripeCode?: string | null; stripeParam?: string | null };
  return (details.stripeCode === "resource_missing" && details.stripeParam === "customer") || /No such customer/i.test(error.message);
}
