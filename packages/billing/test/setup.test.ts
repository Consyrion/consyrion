import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import { createDatabase, getPlanCatalog, schema, type DatabaseHandle } from "@consyrion/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStripe, stripeConfig, stripeStatus, type FetchLike } from "../src";

let handle: DatabaseHandle;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
const input = { amountCents: 499, webhookUrl: "https://app.example.test/api/billing/webhook", returnUrl: "https://app.example.test/settings/billing" };

/** Fake Stripe: records calls and answers with ids per endpoint. */
function fakeStripe(account = "acct_1") {
  const calls: Array<{ method: string; path: string; body: URLSearchParams }> = [];
  let n = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ method: init?.method ?? "GET", path, body: new URLSearchParams(String(init?.body ?? "")) });
    n += 1;
    const body: Record<string, unknown> =
      path === "/v1/account"
        ? { id: account }
        : path === "/v1/webhook_endpoints"
          ? { id: `we_${n}`, secret: `whsec_${n}` }
          : { id: `${path.split("/")[2]}_${n}` };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetchImpl };
}

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "admin", name: "A", email: "a@example.test" });
});
afterEach(async () => {
  await handle.close();
});

describe("Stripe setup from /admin", () => {
  it("creates product, VAT-inclusive monthly price, webhook and portal, stores the key encrypted and prices Pro", async () => {
    const stripe = fakeStripe();
    await setupStripe(handle.db, keyring, "admin", { ...input, secretKey: "sk_test_abcdefghijkl" }, stripe.fetchImpl);
    const price = stripe.calls.find((c) => c.path === "/v1/prices")!;
    expect(price.body.get("unit_amount")).toBe("499");
    expect(price.body.get("currency")).toBe("eur");
    expect(price.body.get("recurring[interval]")).toBe("month");
    expect(price.body.get("tax_behavior")).toBe("inclusive");
    expect(stripe.calls.find((c) => c.path === "/v1/webhook_endpoints")!.body.get("url")).toBe(input.webhookUrl);

    const [row] = await handle.db.select().from(schema.platformSetting);
    expect(row!.secret).not.toContain("sk_test_abcdefghijkl");
    expect(JSON.stringify(row!.value)).not.toContain("sk_test_abcdefghijkl");
    const config = await stripeConfig(handle.db, keyring, {});
    expect(config).toMatchObject({ secretKey: "sk_test_abcdefghijkl", webhookSecret: expect.stringMatching(/^whsec_/) });
    expect(await stripeStatus(handle.db)).toMatchObject({ connected: true, mode: "test", amountCents: 499, keyHint: "••••ijkl" });

    const pro = (await getPlanCatalog(handle.db)).find((p) => p.key === "pro")!;
    expect(pro.stripePriceId).toBe(config && (await stripeStatus(handle.db)).priceId);
    expect(pro.priceLabel).toBe("4.99 € / month");
  });

  it("changes only the price without the key again and archives the old price", async () => {
    await setupStripe(handle.db, keyring, "admin", { ...input, secretKey: "sk_test_abcdefghijkl" }, fakeStripe().fetchImpl);
    const old = (await stripeStatus(handle.db)).priceId;
    const second = fakeStripe();
    await setupStripe(handle.db, keyring, "admin", { ...input, amountCents: 599 }, second.fetchImpl);
    expect(second.calls.map((c) => c.path)).toEqual(["/v1/account", "/v1/prices", `/v1/prices/${old}`]);
    expect(second.calls[2]!.body.get("active")).toBe("false");
    expect((await getPlanCatalog(handle.db)).find((p) => p.key === "pro")!.priceLabel).toBe("5.99 € / month");
  });

  it("refuses keys that are not Stripe secret keys and works without any setup through the environment", async () => {
    await expect(setupStripe(handle.db, keyring, "admin", { ...input, secretKey: "pk_test_123456789" }, fakeStripe().fetchImpl)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await stripeConfig(handle.db, keyring, {})).toBeNull();
    expect(await stripeConfig(handle.db, keyring, { STRIPE_SECRET_KEY: "sk_test_env", STRIPE_WEBHOOK_SECRET: "whsec_env" })).toMatchObject({
      secretKey: "sk_test_env",
    });
  });
});
