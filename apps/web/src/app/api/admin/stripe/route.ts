import { setupStripe, stripeStatus } from "@consyrion/billing";
import { DomainError } from "@consyrion/core";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { publicOrigin } from "@/lib/server/origin";

/** Stripe connection status for /admin – never the key. */
export const GET = handle(async () => {
  await requirePlatformAdmin();
  return NextResponse.json(await stripeStatus(await getDb()));
});

/** Connect Stripe (new secret key) and/or set the Pro price in euros, VAT included. */
export const POST = handle(async (request: Request) => {
  const admin = await requirePlatformAdmin();
  const body = (await readJson(request)) as { secretKey?: string; amount?: string | number };
  const amount = Number(String(body.amount ?? "").replace(",", "."));
  if (!Number.isFinite(amount)) throw new DomainError("VALIDATION", "Enter the monthly price in euros, e.g. 4.99");
  const origin = publicOrigin(request);
  const result = await setupStripe(await getDb(), getKeyring(), admin.id, {
    secretKey: typeof body.secretKey === "string" ? body.secretKey : undefined,
    amountCents: Math.round(amount * 100),
    webhookUrl: `${origin}/api/billing/webhook`,
    returnUrl: `${origin}/settings/billing`,
  });
  return NextResponse.json(result);
});
