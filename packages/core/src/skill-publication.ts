import type { SkillReviewLight } from "./skill-publication-scan";

/**
 * SkillHub publication model (#368, ADR docs/adr/0368-skillhub.md). Pure rules shared by the repositories and the UI:
 * review states and allowed transitions, who may trigger them, the licence, publisher handles and report reasons.
 *
 * Access scopes are private → team → public. `skill.visibility` keeps the in-workspace scope (private/team); "public"
 * is a published, reviewed version (`skill.publicVersion`). `listed` only controls whether the public catalog shows it –
 * it is never an access control.
 */

/** Licence for every public skill – owner decision 08.11.26 (skills are texts, the author is named; as in #363). */
export const SKILL_PUBLICATION_LICENSE = {
  id: "CC-BY-4.0",
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/** Upload gate (owner decision 08.11.26): Pro plan, verified e-mail and an account at least this old. */
export const SKILL_PUBLISHER_MIN_ACCOUNT_AGE_DAYS = 14;

/**
 * Review state of one skill version. Only `published` is public. `rejected` and `withdrawn` are final for that
 * version – a fix is a new version with a new review.
 */
export const SKILL_REVIEW_STATUSES = ["draft", "scanning", "pending_review", "published", "rejected", "quarantined", "withdrawn"] as const;
export type SkillReviewStatus = (typeof SKILL_REVIEW_STATUSES)[number];

export type SkillReviewActor = "author" | "system" | "admin";

/** Allowed transitions and who may trigger them. Everything else is refused on the server. */
const TRANSITIONS: Readonly<Record<SkillReviewStatus, Partial<Record<SkillReviewStatus, ReadonlyArray<SkillReviewActor>>>>> = {
  draft: { scanning: ["author"] },
  scanning: { pending_review: ["system"], quarantined: ["system"] },
  // `system` → published only through the admin's auto-approval switch, and only for green (see canPublish).
  pending_review: { published: ["admin", "system"], rejected: ["admin"], quarantined: ["admin", "system"] },
  published: { withdrawn: ["author", "admin"], quarantined: ["admin", "system"] },
  quarantined: { pending_review: ["admin"], rejected: ["admin"] },
  rejected: {},
  withdrawn: {},
};

export function canReviewTransition(from: SkillReviewStatus, to: SkillReviewStatus, actor: SkillReviewActor): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/**
 * Whether a version may become public. Red is never publishable – not even by an admin (owner decision 08.11.26); the
 * author submits a new version instead. Yellow and green need an admin, unless the admin enabled auto-approval, which
 * only ever applies to green from both the static scan and the model review.
 */
export function canPublish(input: {
  actor: Extract<SkillReviewActor, "admin" | "system">;
  scanLight: SkillReviewLight;
  /** Model review light; null when no reviewer key is configured (then an admin decides). */
  aiLight: SkillReviewLight | null;
  autoApproveGreen: boolean;
}): boolean {
  if (input.scanLight === "red" || input.aiLight === "red") return false;
  if (input.actor === "admin") return true;
  return input.autoApproveGreen && input.scanLight === "green" && input.aiLight === "green";
}

/** The stricter of two lights – a later check can only raise the level, never lower it. */
export function stricterLight(a: SkillReviewLight, b: SkillReviewLight | null): SkillReviewLight {
  const rank: Record<SkillReviewLight, number> = { green: 0, yellow: 1, red: 2 };
  return b && rank[b] > rank[a] ? b : a;
}

/** Handles and slugs: lower-case letters, digits and single hyphens. Shown as `@handle/slug`. */
const HANDLE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,30}[a-z0-9]$/;
const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,58}[a-z0-9]$/;

/** Names that would suggest an official, verified or third-party identity. */
const RESERVED = [
  "consyrion",
  "official",
  "verified",
  "admin",
  "administrator",
  "moderator",
  "mod",
  "staff",
  "support",
  "security",
  "system",
  "root",
  "api",
  "skills",
  "skillhub",
  "help",
  "team",
  "anthropic",
  "claude",
  "openai",
  "chatgpt",
  "google",
  "gemini",
  "microsoft",
  "github",
  "meta",
  "xai",
  "deepseek",
];

export type HandleProblem = "format" | "reserved";

export function validatePublisherHandle(handle: string): HandleProblem | null {
  if (!HANDLE.test(handle)) return "format";
  return RESERVED.some((word) => handle === word || handle.startsWith(`${word}-`) || handle.endsWith(`-${word}`) || handle.includes("official"))
    ? "reserved"
    : null;
}

export function validateSkillSlug(slug: string): HandleProblem | null {
  if (!SLUG.test(slug)) return "format";
  return /(?:^|-)(?:official|verified)(?:-|$)/.test(slug) ? "reserved" : null;
}

/** A slug proposal from the skill name ("Data protection check (GDPR)" → "data-protection-check-gdpr"). */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const SKILL_REPORT_REASONS = ["misleading", "injection", "personal_data", "impersonation", "spam", "copyright", "other"] as const;
export type SkillReportReason = (typeof SKILL_REPORT_REASONS)[number];

/** Every step of the review is logged (owner requirement: audit log). Reports never hide a skill on their own. */
export const SKILL_MODERATION_ACTIONS = [
  "submit",
  "scan",
  "ai_review",
  "approve",
  "auto_approve",
  "reject",
  "quarantine",
  "restore",
  "withdraw",
  "hide",
  "unhide",
  "report",
  "report_resolved",
  "suspend_publisher",
  "unsuspend_publisher",
  "rescan",
  "setting_changed",
] as const;
export type SkillModerationAction = (typeof SKILL_MODERATION_ACTIONS)[number];
