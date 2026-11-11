import { getSkillReviewerConfig, setSkillReviewerConfig, skillReviewTokensThisMonth } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

/**
 * SkillHub reviewer settings for /admin (#423 step 3): provider, model, caps, kill switch, auto-approval switch and the
 * platform reviewer key (documented BYOK exception, owner decision 08.11.2026). The key is write-only – never returned.
 */
export const GET = handle(async () => {
  await requirePlatformAdmin();
  const db = await getDb();
  return NextResponse.json({ ...(await getSkillReviewerConfig(db)), usedThisMonth: await skillReviewTokensThisMonth(db) });
});

/** Body: settings fields, plus `apiKey` (new key) or `removeKey: true`. */
export const PUT = handle(async (request: Request) => {
  const admin = await requirePlatformAdmin();
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown> & { apiKey?: unknown; removeKey?: unknown };
  const { apiKey, removeKey, ...settings } = body;
  const key = removeKey === true ? null : typeof apiKey === "string" && apiKey.trim() ? apiKey : undefined;
  const db = await getDb();
  const config = await setSkillReviewerConfig(db, admin.id, settings, key, getKeyring());
  return NextResponse.json({ ...config, usedThisMonth: await skillReviewTokensThisMonth(db) });
});
