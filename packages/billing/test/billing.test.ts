import { createHmac } from "node:crypto";
import { createDatabase, ensurePersonalOrganization, getEntitlements, schema, type DatabaseHandle } from "@consyrion/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleStripeEvent, StripeClient, verifyStripeSignature, type FetchLike } from "../src";

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
