import { stripeConfigFromEnv, StripeClient } from "@consyrion/billing";
import { assertCan, DomainError, PLAN_KEYS, type PlanKey } from "@consyrion/core";
import { getPlanCatalog, getSubscription } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor, requireUser } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { publicOrigin } from "@/lib/server/origin";

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  assertCan(actor.role, "billing:manage");
  const user = await requireUser();
  const config = stripeConfigFromEnv();
  if (!config) throw new DomainError("CONFIGURATION", "Online checkout is not configured; contact us to change your plan");
  const { plan } = (await readJson(request)) as { plan?: string };
  if (!PLAN_KEYS.includes(plan as PlanKey)) throw new DomainError("VALIDATION", "Unknown plan");
  const db = await getDb();
  const definition = (await getPlanCatalog(db)).find((p) => p.key === plan);
  if (!definition?.active || !definition.stripePriceId) throw new DomainError("CONFLICT", "This plan cannot be bought online");
  const origin = publicOrigin(request);
  const session = await new StripeClient(config).createCheckoutSession({
    priceId: definition.stripePriceId,
    organizationId: actor.organizationId,
    plan: definition.key,
    customerEmail: user.email,
    customerId: (await getSubscription(db, actor.organizationId)).stripeCustomerId,
    successUrl: `${origin}/settings/billing?checkout=success`,
    cancelUrl: `${origin}/settings/billing`,
  });
  return NextResponse.json({ url: session.url });
});
