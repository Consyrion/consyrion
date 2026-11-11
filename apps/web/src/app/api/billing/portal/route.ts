import { isMissingStripeCustomer, StripeClient } from "@consyrium/billing";
import { assertCan, DomainError } from "@consyrium/core";
import { forgetStripeCustomer, getSubscription } from "@consyrium/db";
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
  // { flow: "cancel" } = "back to Free": the portal opens at the cancellation step of the current subscription.
  const body = (await request.json().catch(() => ({}))) as { flow?: unknown };
  const cancel = body?.flow === "cancel";
  if (cancel && !sub.stripeSubscriptionId) throw new DomainError("CONFLICT", "No online subscription to manage");
  try {
    const portal = await new StripeClient(config).createPortalSession(sub.stripeCustomerId, `${publicOrigin(request)}/settings/billing?portal=return`, {
      cancelSubscriptionId: cancel ? sub.stripeSubscriptionId : null,
    });
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
