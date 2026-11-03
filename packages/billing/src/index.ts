import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError, PLAN_KEYS, type PlanKey } from "@consyrion/core";
import { getPlanCatalog, upsertStripeSubscription, type Database } from "@consyrion/db";

/**
 * Stripe billing for the platform subscription only. Consyrion never charges for AI usage (BYOK,
 * issue #30). Without STRIPE_SECRET_KEY nothing here is reachable and nothing is charged.
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
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

  private async request<T>(method: "GET" | "POST", path: string, data?: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.secretKey}`, ...(data ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: data ? form(data) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) throw new DomainError("PROVIDER_ERROR", `Stripe request failed (${response.status})`);
    return json;
  }

  createCheckoutSession(input: { priceId: string; organizationId: string; plan: PlanKey; customerEmail: string; customerId?: string | null; successUrl: string; cancelUrl: string }) {
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

  createPortalSession(customerId: string, returnUrl: string) {
    return this.request<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
  }
}

/** Verifies the Stripe-Signature header (t=…,v1=…) with a tolerance against replay. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000)): boolean {
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

/** Applies a verified webhook event. Unknown events are ignored. */
export async function handleStripeEvent(db: Database, event: { type: string; data: { object: unknown } }) {
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return { handled: false };
  const sub = event.data.object as StripeSubscriptionObject;
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
    status: event.type === "customer.subscription.deleted" ? "canceled" : (STATUS_MAP[sub.status] ?? "incomplete"),
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  });
  return { handled: true };
}
