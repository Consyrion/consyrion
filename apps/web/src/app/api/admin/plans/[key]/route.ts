import { DomainError, PLAN_KEYS, type Entitlements, type PlanKey } from "@consyrium/core";
import { updatePlanDefinition } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const PUT = handle(async (request: Request, { params }: { params: Promise<{ key: string }> }) => {
  const admin = await requirePlatformAdmin();
  const key = (await params).key as PlanKey;
  if (!PLAN_KEYS.includes(key)) throw new DomainError("NOT_FOUND", "Unknown plan");
  const body = (await readJson(request)) as { name: string; entitlements: Entitlements; priceLabel: string | null; stripePriceId: string | null; active: boolean };
  await updatePlanDefinition(await getDb(), admin.id, key, { name: String(body.name), entitlements: body.entitlements, priceLabel: body.priceLabel || null, stripePriceId: body.stripePriceId || null, active: Boolean(body.active) });
  return NextResponse.json({ ok: true });
});
