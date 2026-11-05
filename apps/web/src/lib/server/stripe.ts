import "server-only";
import { stripeConfig } from "@consyrion/billing";
import type { Keyring } from "@consyrion/core";
import { getDb } from "./db";
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
