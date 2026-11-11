import { assistantBudget, getAssistantPreference, setAssistantPreference } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The user's assistant settings (#281) with today's and this month's usage against their limits. */
export const GET = handle(async () => {
  const actor = await requireActor();
  const db = await getDb();
  return NextResponse.json({ preference: await getAssistantPreference(db, actor), budget: await assistantBudget(db, actor) });
});

/**
 * Body: any of { credentialId, modelId, reviewerCredentialId, reviewerModelId, dailyTokenLimit, monthlyTokenLimit };
 * null clears a field, a missing field stays. Keys must be the workspace's own.
 */
export const PUT = handle(async (request: Request) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as Record<string, unknown>;
  const text = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : null);
  const num = (v: unknown) => (v === undefined ? undefined : typeof v === "number" ? v : v === null || v === "" ? null : Number.NaN);
  const db = await getDb();
  const preference = await setAssistantPreference(db, actor, {
    credentialId: text(body.credentialId),
    modelId: text(body.modelId),
    reviewerCredentialId: text(body.reviewerCredentialId),
    reviewerModelId: text(body.reviewerModelId),
    dailyTokenLimit: num(body.dailyTokenLimit),
    monthlyTokenLimit: num(body.monthlyTokenLimit),
  });
  return NextResponse.json({ preference, budget: await assistantBudget(db, actor) });
});
