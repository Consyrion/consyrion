import { DomainError, PLAN_KEYS, type PlanKey } from "@consyrium/core";
import { setSubscriptionPlan } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const PUT = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requirePlatformAdmin();
  const { plan } = (await readJson(request)) as { plan?: string };
  if (!PLAN_KEYS.includes(plan as PlanKey)) throw new DomainError("VALIDATION", "Unknown plan");
  await setSubscriptionPlan(await getDb(), admin.id, (await params).id, plan as PlanKey);
  return NextResponse.json({ ok: true });
});
