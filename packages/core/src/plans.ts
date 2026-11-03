/**
 * Platform subscription plans. Consyrion is strictly BYOK (issue #30): plans limit platform usage
 * (seats, projects, councils, sandbox time) – never AI tokens, which customers pay to their provider.
 * The catalog below is only the seed; the platform admin edits names, limits and prices at runtime.
 */
export const PLAN_KEYS = ["starter", "pro", "developer", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface Entitlements {
  maxMembers: number;
  maxProjects: number;
  maxSessionsPerMonth: number;
  maxParticipantsPerSession: number;
  executionCouncil: boolean;
  github: boolean;
  maxExecutionsPerMonth: number;
  /** Fair use of the platform's sandbox infrastructure. */
  maxSandboxMinutesPerMonth: number;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  entitlements: Entitlements;
  /** Display text only, e.g. "CHF 29 / month". Set by the platform admin; null = not published. */
  priceLabel: string | null;
}

export const DEFAULT_PLAN_CATALOG: PlanDefinition[] = [
  { key: "starter", name: "Starter", priceLabel: null, entitlements: { maxMembers: 1, maxProjects: 3, maxSessionsPerMonth: 10, maxParticipantsPerSession: 3, executionCouncil: false, github: false, maxExecutionsPerMonth: 0, maxSandboxMinutesPerMonth: 0 } },
  { key: "pro", name: "Pro", priceLabel: null, entitlements: { maxMembers: 3, maxProjects: 25, maxSessionsPerMonth: 100, maxParticipantsPerSession: 5, executionCouncil: false, github: true, maxExecutionsPerMonth: 0, maxSandboxMinutesPerMonth: 0 } },
  { key: "developer", name: "Developer", priceLabel: null, entitlements: { maxMembers: 5, maxProjects: 50, maxSessionsPerMonth: 200, maxParticipantsPerSession: 6, executionCouncil: true, github: true, maxExecutionsPerMonth: 50, maxSandboxMinutesPerMonth: 600 } },
  { key: "business", name: "Business", priceLabel: null, entitlements: { maxMembers: 50, maxProjects: 500, maxSessionsPerMonth: 2_000, maxParticipantsPerSession: 6, executionCouncil: true, github: true, maxExecutionsPerMonth: 500, maxSandboxMinutesPerMonth: 6_000 } },
];

export const DEFAULT_PLAN: PlanKey = "starter";

/**
 * Self-hosted installations (SELF_HOSTED=true) have no plans: every workspace gets these limits. Council size is
 * still bounded by the absolute limits in policy.ts.
 */
export const SELF_HOSTED_ENTITLEMENTS: Entitlements = {
  maxMembers: 1_000_000,
  maxProjects: 1_000_000,
  maxSessionsPerMonth: 1_000_000,
  maxParticipantsPerSession: 1_000_000,
  executionCouncil: true,
  github: true,
  maxExecutionsPerMonth: 1_000_000,
  maxSandboxMinutesPerMonth: 1_000_000,
};

export function isSelfHosted(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.SELF_HOSTED ?? "");
}

export function validateEntitlements(e: Entitlements): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(e)) {
    if (typeof value === "number" && (!Number.isInteger(value) || value < 0)) errors.push(`${key} must be a non-negative integer`);
  }
  if (e.maxMembers < 1) errors.push("maxMembers must be at least 1");
  if (e.maxParticipantsPerSession < 2 && e.maxSessionsPerMonth > 0) errors.push("A council needs at least 2 participants");
  return errors;
}
