import {
  normalizeSkillReviewerSettings,
  scanSkillForPublication,
  SKILL_REVIEWER_SETTING,
  validateSkillContent,
  type Keyring,
  type PublicationScanResult,
  type SkillAiReview,
  type SkillContent,
  type SkillReviewerSettings,
  type SkillReviewSkipReason,
} from "@consyrion/core";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { skillModerationLog, skillVersion } from "../schema";
import { getPlatformSetting, setPlatformSetting } from "./platform-settings";

/**
 * SkillHub model review – storage side (#423 step 3). The reviewer key is a platform secret (documented BYOK exception,
 * owner decision 08.11.2026, ADR 0368). This module never decrypts it; only apps/web/src/lib/server/skill-review.ts does.
 *
 * The functions here are system steps of the review pipeline: they run after a submission was authorized for its
 * author (submission flow, PR 4) or from the platform admin's queue, never directly from a request with a raw id.
 */

export interface SkillReviewerConfig {
  settings: SkillReviewerSettings;
  hasKey: boolean;
}

export async function getSkillReviewerConfig(db: Database): Promise<SkillReviewerConfig> {
  const row = await getPlatformSetting(db, SKILL_REVIEWER_SETTING);
  return { settings: normalizeSkillReviewerSettings(row?.value), hasKey: Boolean(row?.hasSecret) };
}

/**
 * Platform admin only (the route checks it). `apiKey` undefined keeps the stored key, null removes it. The change is
 * audited without values (setPlatformSetting); the key is never returned.
 */
export async function setSkillReviewerConfig(db: Database, adminUserId: string, input: unknown, apiKey: string | null | undefined, keyring: Keyring) {
  const settings = normalizeSkillReviewerSettings(input);
  const key = typeof apiKey === "string" ? apiKey.trim() || undefined : apiKey;
  await setPlatformSetting(db, adminUserId, SKILL_REVIEWER_SETTING, { ...settings }, key, keyring);
  return getSkillReviewerConfig(db);
}

/** Tokens the model review used in the current calendar month (UTC) – the monthly budget counts against this. */
export async function skillReviewTokensThisMonth(db: Database, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [row] = await db
    .select({
      used: sql<number>`coalesce(sum(coalesce((${skillVersion.aiReview}->'usage'->>'inputTokens')::int, 0) + coalesce((${skillVersion.aiReview}->'usage'->>'outputTokens')::int, 0)), 0)`,
    })
    .from(skillVersion)
    .where(sql`(${skillVersion.aiReview}->>'reviewedAt') >= ${start}`);
  return Number(row?.used ?? 0);
}

export interface SkillVersionForReview {
  skillId: string;
  version: number;
  content: SkillContent;
  contentHash: string;
  changelog: string | null;
  scan: PublicationScanResult;
}

/** Content of one version plus its static scan (computed now when it was not stored yet). */
export async function getSkillVersionForReview(db: Database, skillId: string, version: number): Promise<SkillVersionForReview | null> {
  const [row] = await db
    .select()
    .from(skillVersion)
    .where(and(eq(skillVersion.skillId, skillId), eq(skillVersion.version, version)));
  if (!row) return null;
  const checked = validateSkillContent(row.content);
  if (!checked.ok) return null;
  const scan = row.scanResult ?? scanSkillForPublication(checked.content, { changelog: row.changelog });
  return { skillId, version, content: checked.content, contentHash: row.contentHash, changelog: row.changelog, scan };
}

export type StoredSkillAiReview = SkillAiReview | { skipped: SkillReviewSkipReason | "provider_error"; reviewedAt: string; promptVersion: number };

/** Stores the model review (or why it was skipped) on the version and writes the audit log entry. */
export async function recordSkillAiReview(db: Database, ref: { skillId: string; version: number; contentHash: string }, review: StoredSkillAiReview) {
  await db.transaction(async (tx) => {
    await tx
      .update(skillVersion)
      .set({ aiReview: review as unknown as Record<string, unknown> })
      .where(and(eq(skillVersion.skillId, ref.skillId), eq(skillVersion.version, ref.version)));
    await tx.insert(skillModerationLog).values({
      id: newId("sml"),
      skillId: ref.skillId,
      version: ref.version,
      actorUserId: null,
      action: "ai_review",
      detail:
        "skipped" in review
          ? { skipped: review.skipped, contentHash: ref.contentHash, promptVersion: review.promptVersion }
          : {
              light: review.light,
              invalidOutput: review.invalidOutput ?? false,
              findings: review.findings.length,
              model: `${review.provider}/${review.model}`,
              tokens: review.usage.inputTokens + review.usage.outputTokens,
              contentHash: ref.contentHash,
              promptVersion: review.promptVersion,
            },
    });
  });
}
