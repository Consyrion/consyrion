import { stripeConfigFromEnv, StripeClient } from "@consyrion/billing";
import { assertCan, DomainError } from "@consyrion/core";
import { getSubscription } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { publicOrigin } from "@/lib/server/origin";

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  assertCan(actor.role, "billing:manage");
  const config = stripeConfigFromEnv();
  const sub = await getSubscription(await getDb(), actor.organizationId);
  if (!config || !sub.stripeCustomerId) throw new DomainError("CONFLICT", "No online subscription to manage");
  const portal = await new StripeClient(config).createPortalSession(sub.stripeCustomerId, `${publicOrigin(request)}/settings/billing`);
  return NextResponse.json({ url: portal.url });
});
