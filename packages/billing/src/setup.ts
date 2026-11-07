import { DomainError, maskSecret, type Entitlements, type Keyring } from "@consyrion/core";
import { getPlanCatalog, getPlatformSecret, getPlatformSetting, setPlatformSetting, updatePlanDefinition, type Database } from "@consyrion/db";
import { StripeClient, stripeConfigFromEnv, type FetchLike, type StripeConfig } from "./index";

/**
 * Stripe connection set up from /admin (same approach as OnJam): the admin pastes the secret key once; the app
 * creates the product, the monthly price, the webhook and the customer portal configuration at Stripe and stores
 * the key and the webhook secret encrypted in `platform_setting` (never shown again). Env variables remain a
 * fallback for installations that configure Stripe outside the app.
 */
export const STRIPE_SETTING = "stripe";
const PLAN = "pro" as const;
/**
 * Stripe product tax code "Software as a service (SaaS) – personal use". Required by Stripe Tax and by Managed
 * Payments (Stripe as merchant of record), which refuse checkout for a product without one.
 */
export const TAX_CODE = "txcd_10103000";
const WEBHOOK_EVENTS = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

export interface StripeSettingValue extends Record<string, unknown> {
  mode: "test" | "live";
  keyHint: string;
  accountId: string;
  productId: string;
  priceId: string;
  amountCents: number;
  currency: "eur";
  webhookId: string;
  portalConfigurationId: string;
}

interface StoredSecret {
  secretKey: string;
  webhookSecret: string;
}

function keyMode(secretKey: string): "test" | "live" {
  if (/^(sk|rk)_test_/.test(secretKey)) return "test";
  if (/^(sk|rk)_live_/.test(secretKey)) return "live";
  throw new DomainError("VALIDATION", "This is not a Stripe secret key (sk_test_… or sk_live_…)");
}

/** "4.99 € / month" – the label shown on the billing page; prices are VAT-inclusive (owner decision 05.11.26). */
export function priceLabel(amountCents: number): string {
  return `${(amountCents / 100).toFixed(2)} € / month`;
}

/** Effective Stripe configuration: the admin setup in the database first, then the environment. */
export async function stripeConfig(db: Database, keyring: Keyring | null, env: Record<string, string | undefined> = process.env): Promise<StripeConfig | null> {
  const setting = await getPlatformSetting<StripeSettingValue>(db, STRIPE_SETTING);
  if (setting?.hasSecret && keyring) {
    const raw = await getPlatformSecret(db, STRIPE_SETTING, keyring);
    if (raw) {
      const secret = JSON.parse(raw) as StoredSecret;
      return { secretKey: secret.secretKey, webhookSecret: secret.webhookSecret, portalConfigurationId: setting.value.portalConfigurationId };
    }
  }
  return stripeConfigFromEnv(env);
}

/** What /admin may show: never the key itself. */
export async function stripeStatus(db: Database) {
  const setting = await getPlatformSetting<StripeSettingValue>(db, STRIPE_SETTING);
  if (!setting?.hasSecret) return { connected: false as const, fromEnv: Boolean(stripeConfigFromEnv()) };
  const { mode, keyHint, priceId, amountCents, webhookId } = setting.value;
  return { connected: true as const, fromEnv: false, mode, keyHint, priceId, amountCents, webhookId, updatedAt: setting.updatedAt };
}

export interface SetupStripeInput {
  /** New secret key; omitted = keep the stored one (e.g. only the price changes). */
  secretKey?: string;
  amountCents: number;
  /** Public URL of /api/billing/webhook. */
  webhookUrl: string;
  /** Where the customer portal returns to. */
  returnUrl: string;
}

/**
 * Connects Stripe or changes the Pro price. A new key creates product, webhook and portal configuration in that
 * account; a new amount creates a new price and archives the old one (running subscriptions keep their price).
 */
export async function setupStripe(db: Database, keyring: Keyring, adminUserId: string, input: SetupStripeInput, fetchImpl: FetchLike = fetch) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 50 || input.amountCents > 100_000)
    throw new DomainError("VALIDATION", "Price must be between 0.50 € and 1,000 €");
  const existing = await getPlatformSetting<StripeSettingValue>(db, STRIPE_SETTING);
  const storedRaw = existing?.hasSecret ? await getPlatformSecret(db, STRIPE_SETTING, keyring) : null;
  const stored = storedRaw ? (JSON.parse(storedRaw) as StoredSecret) : null;
  const secretKey = input.secretKey?.trim() || stored?.secretKey;
  if (!secretKey) throw new DomainError("VALIDATION", "Paste the Stripe secret key first");
  const mode = keyMode(secretKey);
  const client = new StripeClient({ secretKey, webhookSecret: "" }, fetchImpl);
  const account = await client.request<{ id: string }>("GET", "/v1/account");
  const sameAccount = Boolean(existing && stored && existing.value.accountId === account.id);

  let { productId, webhookId, portalConfigurationId } = sameAccount ? existing!.value : ({} as Partial<StripeSettingValue>);
  let webhookSecret = sameAccount ? stored!.webhookSecret : "";
  if (!productId) {
    productId = (await client.request<{ id: string }>("POST", "/v1/products", { name: "CONSYRION AI Pro", tax_code: TAX_CODE, "metadata[consyrion]": PLAN })).id;
  } else {
    // Products created before the tax code was set (Managed Payments refuses checkout without one).
    await client.request("POST", `/v1/products/${productId}`, { tax_code: TAX_CODE });
  }
  if (!webhookId || !webhookSecret) {
    const hook = await client.request<{ id: string; secret: string }>("POST", "/v1/webhook_endpoints", {
      url: input.webhookUrl,
      description: "CONSYRION AI subscriptions",
      ...Object.fromEntries(WEBHOOK_EVENTS.map((e, i) => [`enabled_events[${i}]`, e])),
    });
    webhookId = hook.id;
    webhookSecret = hook.secret;
  }
  if (!portalConfigurationId) {
    portalConfigurationId = (
      await client.request<{ id: string }>("POST", "/v1/billing_portal/configurations", {
        "features[invoice_history][enabled]": "true",
        "features[payment_method_update][enabled]": "true",
        "features[subscription_cancel][enabled]": "true",
        "features[subscription_cancel][mode]": "at_period_end",
        default_return_url: input.returnUrl,
      })
    ).id;
  }

  let priceId = sameAccount ? existing!.value.priceId : "";
  if (!priceId || existing!.value.amountCents !== input.amountCents) {
    const previous = priceId;
    priceId = (
      await client.request<{ id: string }>("POST", "/v1/prices", {
        product: productId,
        unit_amount: String(input.amountCents),
        currency: "eur",
        "recurring[interval]": "month",
        tax_behavior: "inclusive",
        "metadata[consyrion]": PLAN,
      })
    ).id;
    if (previous) await client.request("POST", `/v1/prices/${previous}`, { active: "false" });
  }

  const value: StripeSettingValue = {
    mode,
    keyHint: maskSecret(secretKey),
    accountId: account.id,
    productId,
    priceId,
    amountCents: input.amountCents,
    currency: "eur",
    webhookId,
    portalConfigurationId,
  };
  await setPlatformSetting(db, adminUserId, STRIPE_SETTING, value, JSON.stringify({ secretKey, webhookSecret } satisfies StoredSecret), keyring);

  const plan = (await getPlanCatalog(db)).find((p) => p.key === PLAN);
  if (plan) {
    await updatePlanDefinition(db, adminUserId, PLAN, {
      name: plan.name,
      entitlements: plan.entitlements as unknown as Entitlements,
      priceLabel: priceLabel(input.amountCents),
      stripePriceId: priceId,
      active: true,
    });
  }
  return { mode, priceId, amountCents: input.amountCents };
}
