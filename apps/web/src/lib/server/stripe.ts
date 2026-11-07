import "server-only";
import { stripeConfig } from "@consyrion/billing";
import type { Keyring } from "@consyrion/core";
import { getDb } from "./db";
import { hasPlaceholders } from "@/lib/legal";
import { getKeyring } from "./keyring";

/** Stripe configuration from the admin setup (encrypted in the database) or the environment; null = no online checkout. */
export async function getStripeConfig() {
  let keyring: Keyring | null = null;
  try {
    keyring = getKeyring();
  } catch {
    // Without a master key only the environment configuration can apply.
  }
  return stripeConfig(await getDb(), keyring);
}

/**
 * Whether customers can subscribe online right now: Stripe is configured, and a live key is only used once the legal
 * pages are final (same rule as /api/billing/checkout and the billing page).
 */
export async function onlineCheckoutOpen(config?: Awaited<ReturnType<typeof getStripeConfig>>) {
  const stripe = config === undefined ? await getStripeConfig() : config;
  return Boolean(stripe) && !(/^(sk|rk)_live_/.test(stripe!.secretKey) && hasPlaceholders());
}
