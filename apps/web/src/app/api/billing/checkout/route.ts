import { isMissingStripeCustomer, StripeClient } from "@consyrion/billing";
import { assertCan, DomainError, PLAN_KEYS, type PlanKey } from "@consyrion/core";
import { forgetStripeCustomer, getPlanCatalog, getSubscription } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor, requireUser } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { publicOrigin } from "@/lib/server/origin";
import { getStripeConfig } from "@/lib/server/stripe";
import { hasPlaceholders } from "@/lib/legal";

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  assertCan(actor.role, "billing:manage");
  const user = await requireUser();
  const config = await getStripeConfig();
  // No live sale while Impressum/AGB still show placeholders (owner decision 05.11.26); test keys stay usable.
  if (config && /^(sk|rk)_live_/.test(config.secretKey) && hasPlaceholders())
    throw new DomainError("CONFLICT", "Online checkout opens once the legal pages are complete");
  if (!config) throw new DomainError("CONFIGURATION", "Online checkout is not configured; contact us to change your plan");
  const { plan } = (await readJson(request)) as { plan?: string };
  if (!PLAN_KEYS.includes(plan as PlanKey)) throw new DomainError("VALIDATION", "Unknown plan");
  const db = await getDb();
  const definition = (await getPlanCatalog(db)).find((p) => p.key === plan);
  if (!definition?.active || !definition.stripePriceId) throw new DomainError("CONFLICT", "This plan cannot be bought online");
  const origin = publicOrigin(request);
  const stripe = new StripeClient(config);
  const input = {
    priceId: definition.stripePriceId,
    organizationId: actor.organizationId,
    plan: definition.key,
    customerEmail: user.email,
    customerId: (await getSubscription(db, actor.organizationId)).stripeCustomerId,
    successUrl: `${origin}/settings/billing?checkout=success`,
    cancelUrl: `${origin}/settings/billing`,
  };
  try {
    return NextResponse.json({ url: (await stripe.createCheckoutSession(input)).url });
  } catch (error) {
    // A customer Stripe does not know (test mode → live): forget it and let Stripe create a new one from the e-mail.
    if (!input.customerId || !isMissingStripeCustomer(error)) throw error;
    await forgetStripeCustomer(db, actor.organizationId, actor.userId);
    return NextResponse.json({ url: (await stripe.createCheckoutSession({ ...input, customerId: null })).url });
  }
});
