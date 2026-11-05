import { handleStripeEvent, verifyStripeSignature } from "@consyrion/billing";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { getStripeConfig } from "@/lib/server/stripe";

export async function POST(request: Request) {
  const config = await getStripeConfig();
  if (!config) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), config.webhookSecret)) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  await handleStripeEvent(await getDb(), JSON.parse(payload));
  return NextResponse.json({ received: true });
}
