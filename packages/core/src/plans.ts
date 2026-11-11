/**
 * Platform subscription plans. Consyrium is strictly BYOK (issue #30): plans limit platform usage
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
  /** MCP server for external AI clients (Claude Code, Cursor …) – Pro and up on the hosted app. */
  mcp: boolean;
  /** Own skills a workspace may keep (#363); official skills do not count. */
  maxSkills: number;
  /** Sharing skills with the whole workspace (#363). */
  teamSkills: boolean;
  /**
   * Questions to the AI assistant per workspace and day (#281) – a guard against misuse of the platform, not a token
   * limit (tokens are paid by the customer's own key). The platform admin changes it per plan in /admin.
   */
  maxAssistantQuestionsPerDay: number;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  entitlements: Entitlements;
  /** Display text only, e.g. "CHF 29 / month". Set by the platform admin; null = not published. */
  priceLabel: string | null;
}

/** Limits at or above this value mean "unlimited" (shown as such in the UI). */
export const UNLIMITED = 1_000_000;

export function isUnlimited(limit: number): boolean {
  return limit >= UNLIMITED;
}

export const DEFAULT_PLAN_CATALOG: PlanDefinition[] = [
  // Hosted app.consyrium.com (owner decision 05.11.26): Free = 2 councils a month, advice only; Pro = 4.99 € incl. VAT,
  // unlimited councils and the GitHub build. The platform admin can change every value at runtime (/admin).
  {
    key: "starter",
    name: "Free",
    priceLabel: "Free",
    entitlements: {
      maxMembers: 1,
      maxProjects: 3,
      maxSessionsPerMonth: 2,
      maxParticipantsPerSession: 3,
      executionCouncil: false,
      github: false,
      maxExecutionsPerMonth: 0,
      maxSandboxMinutesPerMonth: 0,
      mcp: false,
      maxSkills: 3,
      teamSkills: false,
      maxAssistantQuestionsPerDay: 50,
    },
  },
  {
    key: "pro",
    name: "Pro",
    priceLabel: "4.99 € / month",
    entitlements: {
      maxMembers: 3,
      maxProjects: UNLIMITED,
      maxSessionsPerMonth: UNLIMITED,
      maxParticipantsPerSession: 6,
      executionCouncil: true,
      github: true,
      maxExecutionsPerMonth: UNLIMITED,
      maxSandboxMinutesPerMonth: 0,
      mcp: true,
      maxSkills: UNLIMITED,
      teamSkills: true,
      maxAssistantQuestionsPerDay: 500,
    },
  },
  {
    key: "developer",
    name: "Developer",
    priceLabel: null,
    entitlements: {
      maxMembers: 5,
      maxProjects: 50,
      maxSessionsPerMonth: 200,
      maxParticipantsPerSession: 6,
      executionCouncil: true,
      github: true,
      maxExecutionsPerMonth: 50,
      maxSandboxMinutesPerMonth: 600,
      mcp: true,
      maxSkills: UNLIMITED,
      teamSkills: true,
      maxAssistantQuestionsPerDay: 1_000,
    },
  },
  {
    key: "business",
    name: "Business",
    priceLabel: null,
    entitlements: {
      maxMembers: 50,
      maxProjects: 500,
      maxSessionsPerMonth: 2_000,
      maxParticipantsPerSession: 6,
      executionCouncil: true,
      github: true,
      maxExecutionsPerMonth: 500,
      maxSandboxMinutesPerMonth: 6_000,
      mcp: true,
      maxSkills: UNLIMITED,
      teamSkills: true,
      maxAssistantQuestionsPerDay: UNLIMITED,
    },
  },
];

export const DEFAULT_PLAN: PlanKey = "starter";

/**
 * Self-hosted installations (SELF_HOSTED=true) have no plans: every workspace gets these limits. Council size is
 * still bounded by the absolute limits in policy.ts.
 */
export const SELF_HOSTED_ENTITLEMENTS: Entitlements = {
  maxMembers: UNLIMITED,
  maxProjects: UNLIMITED,
  maxSessionsPerMonth: UNLIMITED,
  maxParticipantsPerSession: UNLIMITED,
  executionCouncil: true,
  github: true,
  maxExecutionsPerMonth: UNLIMITED,
  maxSandboxMinutesPerMonth: UNLIMITED,
  mcp: true,
  maxSkills: UNLIMITED,
  teamSkills: true,
  maxAssistantQuestionsPerDay: UNLIMITED,
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
