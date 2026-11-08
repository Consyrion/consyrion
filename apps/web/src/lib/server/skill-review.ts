import "server-only";
import { createAdapter, PROVIDER_IDS, timeoutSignal, type AdapterFactory, type ProviderId } from "@consyrion/ai";
import {
  buildSkillReviewPrompt,
  estimateSkillReviewTokens,
  parseSkillReviewOutput,
  SKILL_REVIEW_JSON_SCHEMA,
  SKILL_REVIEW_PROMPT_VERSION,
  SKILL_REVIEWER_LIMITS,
  SKILL_REVIEWER_SETTING,
  skillReviewFields,
  skillReviewPrecheck,
  type Keyring,
  type SkillAiReview,
  type SkillReviewSkipReason,
} from "@consyrion/core";
import {
  getPlatformSecret,
  getSkillReviewerConfig,
  getSkillVersionForReview,
  recordSkillAiReview,
  skillReviewTokensThisMonth,
  type Database,
} from "@consyrion/db";

/**
 * SkillHub model review runner (#423 step 3). The ONLY place that decrypts the reviewer key – a platform key under the
 * documented BYOK exception the owner approved on 08.11.2026 (ADR 0368, decision 1): only on consyrion.com, only for
 * this review, with a cap per review and per month. A boundary test keeps every other module away from the secret.
 *
 * Red static results are never sent to the model. Every skip (disabled, no key, budget, provider error) means manual
 * review by an admin – the review never blocks or approves anything on its own here.
 */

export type SkillAiReviewOutcome =
  | { status: "reviewed"; review: SkillAiReview }
  | { status: "skipped"; reason: SkillReviewSkipReason | "provider_error" | "not_found" };

export async function runSkillAiReview(
  db: Database,
  keyring: Keyring,
  ref: { skillId: string; version: number },
  deps: { adapterFactory?: AdapterFactory; now?: () => Date } = {},
): Promise<SkillAiReviewOutcome> {
  const now = deps.now?.() ?? new Date();
  const target = await getSkillVersionForReview(db, ref.skillId, ref.version);
  if (!target) return { status: "skipped", reason: "not_found" };
  const stored = { skillId: target.skillId, version: target.version, contentHash: target.contentHash };
  const skip = async (reason: SkillReviewSkipReason | "provider_error"): Promise<SkillAiReviewOutcome> => {
    await recordSkillAiReview(db, stored, { skipped: reason, reviewedAt: now.toISOString(), promptVersion: SKILL_REVIEW_PROMPT_VERSION });
    return { status: "skipped", reason };
  };

  const { settings, hasKey } = await getSkillReviewerConfig(db);
  const provider = settings.provider as ProviderId;
  const precheck = skillReviewPrecheck({
    settings: { ...settings, enabled: settings.enabled && PROVIDER_IDS.includes(provider) },
    hasKey,
    scan: target.scan,
    estimatedTokens: estimateSkillReviewTokens(target.content, target.changelog),
    usedThisMonth: await skillReviewTokensThisMonth(db, now),
  });
  if (precheck) return skip(precheck);

  const apiKey = await getPlatformSecret(db, SKILL_REVIEWER_SETTING, keyring);
  if (!apiKey) return skip("no_key");
  const { system, user } = buildSkillReviewPrompt(target.content, target.changelog);
  let result;
  try {
    result = await (deps.adapterFactory ?? createAdapter)(provider, apiKey).generate({
      model: settings.model,
      system,
      messages: [{ role: "user", content: user }],
      maxOutputTokens: SKILL_REVIEWER_LIMITS.outputTokens,
      jsonSchema: SKILL_REVIEW_JSON_SCHEMA,
      signal: timeoutSignal(60_000),
    });
  } catch {
    // Provider errors are not logged with details: they may echo request data. The admin reviews manually.
    return skip("provider_error");
  }

  const parsed = parseSkillReviewOutput(
    result.json,
    skillReviewFields(target.content, target.changelog).map((f) => f.field),
  );
  const review: SkillAiReview = {
    ...(parsed ?? { light: "yellow" as const, summary: "The reviewer output could not be read – manual review.", findings: [] }),
    ...(parsed ? {} : { invalidOutput: true }),
    promptVersion: SKILL_REVIEW_PROMPT_VERSION,
    provider: result.provider,
    model: result.model,
    usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    reviewedAt: now.toISOString(),
  };
  await recordSkillAiReview(db, stored, review);
  return { status: "reviewed", review };
}
