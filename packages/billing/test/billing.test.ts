import { createHmac } from "node:crypto";
import { createDatabase, ensurePersonalOrganization, forgetStripeCustomer, getEntitlements, getSubscription, schema, upsertStripeSubscription, type DatabaseHandle } from "@consyrion/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleStripeEvent, isMissingStripeCustomer, StripeClient, verifyStripeSignature, type FetchLike } from "../src";

let handle: DatabaseHandle;
let orgId: string;

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u", name: "U", email: "u@example.test" });
  orgId = (await ensurePersonalOrganization(handle.db, "u", "U")).id;
});
afterEach(async () => {
  await handle.close();
});

const sign = (payload: string, secret: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

describe("stripe", () => {
  it("verifies signatures and rejects replays and tampering", () => {
    const payload = '{"id":"evt_1"}';
    expect(verifyStripeSignature(payload, sign(payload, "whsec", 1000), "whsec", 300, 1100)).toBe(true);
    expect(verifyStripeSignature(payload + " ", sign(payload, "whsec", 1000), "whsec", 300, 1100)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload, "whsec", 1000), "whsec", 300, 2000)).toBe(false);
    expect(verifyStripeSignature(payload, null, "whsec")).toBe(false);
  });

  it("creates a subscription checkout for the platform plan only", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }), { status: 200 });
    };
    const session = await new StripeClient({ secretKey: "sk_test_x", webhookSecret: "w" }, fetchImpl).createCheckoutSession({ priceId: "price_pro", organizationId: orgId, plan: "pro", customerEmail: "u@example.test", successUrl: "https://a/s", cancelUrl: "https://a/c" });
    expect(session.url).toContain("checkout.stripe.com");
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_pro");
    expect(body.get("subscription_data[metadata][organizationId]")).toBe(orgId);
  });

  it("applies subscription webhooks to entitlements", async () => {
    const base = { id: "sub_1", customer: "cus_1", metadata: { organizationId: orgId, plan: "developer" }, current_period_end: 2_000_000_000 };
    expect(await handleStripeEvent(handle.db, { type: "customer.subscription.updated", data: { object: { ...base, status: "active" } } })).toEqual({ handled: true });
    expect((await getEntitlements(handle.db, orgId)).plan).toBe("developer");
    await handleStripeEvent(handle.db, { type: "customer.subscription.deleted", data: { object: { ...base, status: "canceled" } } });
    expect((await getEntitlements(handle.db, orgId)).plan).toBe("starter");
    expect(await handleStripeEvent(handle.db, { type: "invoice.paid", data: { object: {} } })).toEqual({ handled: false });
  });
});

describe("a customer Stripe does not know (owner report 07.11.26)", () => {
  it("recognises 'No such customer' and forgets the stale ids without changing the plan", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ error: { code: "resource_missing", param: "customer", message: "No such customer: 'cus_test123'" } }), { status: 400 });
    const error = await new StripeClient({ secretKey: "sk_live_x", webhookSecret: "w" }, fetchImpl).createPortalSession("cus_test123", "https://a/b").catch((e: unknown) => e);
    expect(isMissingStripeCustomer(error)).toBe(true);
    expect(isMissingStripeCustomer(new Error("No such customer"))).toBe(false);

    await upsertStripeSubscription(handle.db, {
      organizationId: orgId,
      plan: "pro",
      status: "active",
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test",
      currentPeriodEnd: new Date("2026-12-05T00:00:00Z"),
    });
    await forgetStripeCustomer(handle.db, orgId, "u");
    const sub = await getSubscription(handle.db, orgId);
    expect(sub).toMatchObject({ plan: "pro", status: "active", provider: "manual", stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null });
    expect((await getEntitlements(handle.db, orgId)).plan).toBe("pro");
  });
});

describe("cancelled at the period end (owner request 07.11.26)", () => {
  it("keeps the paid plan until Stripe ends the subscription and remembers the cancellation", async () => {
    const base = { id: "sub_2", customer: "cus_2", metadata: { organizationId: orgId, plan: "developer" }, current_period_end: 2_000_000_000 };
    await handleStripeEvent(handle.db, { type: "customer.subscription.updated", data: { object: { ...base, status: "active" } } });
    expect((await getSubscription(handle.db, orgId)).cancelAtPeriodEnd).toBe(false);
    // The customer cancels in the portal: still active and paid, no plan change yet.
    await handleStripeEvent(handle.db, { type: "customer.subscription.updated", data: { object: { ...base, status: "active", cancel_at_period_end: true } } });
    expect(await getSubscription(handle.db, orgId)).toMatchObject({ plan: "developer", status: "active", cancelAtPeriodEnd: true });
    expect((await getEntitlements(handle.db, orgId)).plan).toBe("developer");
    // Undoing the cancellation in the portal clears the flag again.
    await handleStripeEvent(handle.db, { type: "customer.subscription.updated", data: { object: { ...base, status: "active", cancel_at_period_end: false } } });
    expect((await getSubscription(handle.db, orgId)).cancelAtPeriodEnd).toBe(false);
    // At the period end Stripe deletes the subscription: the workspace falls back to the default plan.
    await handleStripeEvent(handle.db, { type: "customer.subscription.deleted", data: { object: { ...base, status: "canceled", cancel_at_period_end: true } } });
    expect(await getSubscription(handle.db, orgId)).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });
    expect((await getEntitlements(handle.db, orgId)).plan).toBe("starter");
  });
});
