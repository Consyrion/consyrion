import { isMissingStripeCustomer, StripeClient } from "@consyrion/billing";
import { assertCan, DomainError } from "@consyrion/core";
import { forgetStripeCustomer, getSubscription } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { publicOrigin } from "@/lib/server/origin";
import { getStripeConfig } from "@/lib/server/stripe";

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  assertCan(actor.role, "billing:manage");
  const config = await getStripeConfig();
  const db = await getDb();
  const sub = await getSubscription(db, actor.organizationId);
  if (!config || !sub.stripeCustomerId) throw new DomainError("CONFLICT", "No online subscription to manage");
  try {
    const portal = await new StripeClient(config).createPortalSession(sub.stripeCustomerId, `${publicOrigin(request)}/settings/billing`);
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    if (!isMissingStripeCustomer(error)) throw error;
    await forgetStripeCustomer(db, actor.organizationId, actor.userId);
    throw new DomainError(
      "CONFLICT",
      "This subscription does not exist in the connected Stripe account (it was probably created in Stripe test mode). Your plan stays as it is; start a new subscription to manage it online.",
    );
  }
});
