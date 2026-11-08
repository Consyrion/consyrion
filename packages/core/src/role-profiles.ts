import { createHash } from "node:crypto";
import { COUNCIL_ROLES, type CouncilRole } from "./phases";
import { scanSkillContent, SKILL_SCHEMA_VERSION } from "./skills";

/**
 * Expert Library, stage 1 (#270): a role profile is a workspace's own, versioned addition to one of the twelve existing
 * 12 Minds roles – a core question, 3–8 review lenses, when the perspective does not fit, and its sources. It changes
 * only what that role looks at: never the number of independent models, votes, the requirement gate, thresholds or
 * weights (three roles on one model stay one model). Profile text reaches the models as untrusted data, never as
 * instructions. No real persons, no invented quotes or authorities. Pure module (no I/O) except the content hash.
 * New roles beyond the twelve are stage 2 (#446).
 */

export const ROLE_PROFILE_SCHEMA_VERSION = 1;

export const ROLE_PROFILE_VISIBILITIES = ["private", "team"] as const;
export type RoleProfileVisibility = (typeof ROLE_PROFILE_VISIBILITIES)[number];

/**
 * How well a source is backed: `verified` (link checked on `checkedAt`), `unconfirmed`, `outdated`, or `own_statement`
 * (the author's own assessment without an external source – the honest label when nothing can be cited).
 */
export const ROLE_PROFILE_SOURCE_STATUSES = ["verified", "unconfirmed", "outdated", "own_statement"] as const;
export type RoleProfileSourceStatus = (typeof ROLE_PROFILE_SOURCE_STATUSES)[number];

export const ROLE_PROFILE_LIMITS = {
  name: 80,
  coreQuestion: 300,
  lens: 300,
  minLenses: 3,
  maxLenses: 8,
  notSuitableFor: 600,
  sources: 10,
  sourceTitle: 200,
  sourceUrl: 500,
  sourceNote: 300,
} as const;

export interface RoleProfileSource {
  title: string;
  /** https link; required for `verified`, optional otherwise, never for `own_statement`. */
  url: string | null;
  status: RoleProfileSourceStatus;
  /** Date the link was checked (YYYY-MM-DD); required for `verified`. */
  checkedAt: string | null;
  note: string | null;
}

export interface RoleProfileContent {
  schemaVersion: typeof ROLE_PROFILE_SCHEMA_VERSION;
  /** The existing 12 Minds role this profile adds to. */
  role: CouncilRole;
  name: string;
  /** The one guiding question of this perspective. */
  coreQuestion: string;
  /** 3–8 concrete review lenses / principles. */
  lenses: string[];
  /** When this perspective is not the right one (scope limit). */
  notSuitableFor: string;
  sources: RoleProfileSource[];
}

/** What a council stores per profile it used (#270): reference plus the content it showed the models, frozen at the start. */
export interface RoleProfileSessionSnapshot {
  /** `curated:<slug>` for shipped profiles, else the profile row id. */
  profileId: string;
  version: number;
  contentHash: string;
  content: RoleProfileContent;
}

type Result = { ok: true; content: RoleProfileContent; ignoredFields: string[] } | { ok: false; errors: string[]; ignoredFields: string[] };

const KNOWN_FIELDS = ["schemaVersion", "role", "name", "coreQuestion", "lenses", "notSuitableFor", "sources"] as const;
const KNOWN_SOURCE_FIELDS = ["title", "url", "status", "checkedAt", "note"] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/[ \t]+/g, " ") : null);

function httpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Validates untrusted input (editor, API) into a RoleProfileContent with trimmed strings and only known fields; unknown
 * fields are reported in `ignoredFields`, never stored. Every text is scanned like skill text (no keys or tokens, no
 * e-mail addresses, no text that tries to change the council's rules).
 */
export function validateRoleProfileContent(input: unknown): Result {
  if (!isRecord(input)) return { ok: false, errors: ["A role profile must be a JSON object"], ignoredFields: [] };
  const errors: string[] = [];
  const ignoredFields = Object.keys(input).filter((k) => !(KNOWN_FIELDS as readonly string[]).includes(k));
  const sv = input.schemaVersion ?? ROLE_PROFILE_SCHEMA_VERSION;
  if (sv !== ROLE_PROFILE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${ROLE_PROFILE_SCHEMA_VERSION}`);
  const role = input.role;
  if (typeof role !== "string" || !(COUNCIL_ROLES as readonly string[]).includes(role)) errors.push("role must be one of the 12 Minds roles");

  const field = (key: "name" | "coreQuestion" | "notSuitableFor", required: boolean) => {
    const value = text(input[key]);
    const max = ROLE_PROFILE_LIMITS[key];
    if (value === null || (required && !value)) errors.push(`${key} is required`);
    else if (value.length > max) errors.push(`${key} is longer than ${max} characters`);
    return value ?? "";
  };
  const name = field("name", true);
  const coreQuestion = field("coreQuestion", true);
  const notSuitableFor = field("notSuitableFor", true);

  const lenses: string[] = [];
  if (!Array.isArray(input.lenses)) errors.push("lenses must be a list");
  else {
    for (const [i, raw] of input.lenses.entries()) {
      const lens = text(raw);
      if (!lens) errors.push(`lenses[${i}] must be a non-empty text`);
      else if (lens.length > ROLE_PROFILE_LIMITS.lens) errors.push(`lenses[${i}] is longer than ${ROLE_PROFILE_LIMITS.lens} characters`);
      else lenses.push(lens);
    }
    if (new Set(lenses.map((l) => l.toLowerCase())).size !== lenses.length) errors.push("lenses must be different from each other");
    if (input.lenses.length < ROLE_PROFILE_LIMITS.minLenses || input.lenses.length > ROLE_PROFILE_LIMITS.maxLenses)
      errors.push(`between ${ROLE_PROFILE_LIMITS.minLenses} and ${ROLE_PROFILE_LIMITS.maxLenses} lenses are required`);
  }

  const sources: RoleProfileSource[] = [];
  const rawSources = input.sources ?? [];
  if (!Array.isArray(rawSources)) errors.push("sources must be a list");
  else {
    if (rawSources.length > ROLE_PROFILE_LIMITS.sources) errors.push(`at most ${ROLE_PROFILE_LIMITS.sources} sources`);
    for (const [i, raw] of rawSources.entries()) {
      if (!isRecord(raw)) {
        errors.push(`sources[${i}] must be an object`);
        continue;
      }
      ignoredFields.push(
        ...Object.keys(raw)
          .filter((k) => !(KNOWN_SOURCE_FIELDS as readonly string[]).includes(k))
          .map((k) => `sources[${i}].${k}`),
      );
      const title = text(raw.title);
      const url = text(raw.url) || null;
      const status = raw.status;
      const checkedAt = text(raw.checkedAt) || null;
      const note = text(raw.note) || null;
      if (!title) errors.push(`sources[${i}].title is required`);
      else if (title.length > ROLE_PROFILE_LIMITS.sourceTitle) errors.push(`sources[${i}].title is too long`);
      if (typeof status !== "string" || !(ROLE_PROFILE_SOURCE_STATUSES as readonly string[]).includes(status))
        errors.push(`sources[${i}].status must be one of ${ROLE_PROFILE_SOURCE_STATUSES.join(", ")}`);
      if (url !== null && (url.length > ROLE_PROFILE_LIMITS.sourceUrl || !httpsUrl(url))) errors.push(`sources[${i}].url must be an https link`);
      if (status === "verified" && (!url || !checkedAt)) errors.push(`sources[${i}]: a verified source needs a link and the date it was checked`);
      if (status === "own_statement" && url) errors.push(`sources[${i}]: an own statement has no link – use "unconfirmed" or "verified" for a cited source`);
      if (checkedAt !== null && !validDate(checkedAt)) errors.push(`sources[${i}].checkedAt must be a date (YYYY-MM-DD)`);
      if (note !== null && note.length > ROLE_PROFILE_LIMITS.sourceNote) errors.push(`sources[${i}].note is too long`);
      sources.push({ title: title ?? "", url, status: status as RoleProfileSourceStatus, checkedAt, note });
    }
  }
  if (errors.length) return { ok: false, errors, ignoredFields };

  const content: RoleProfileContent = {
    schemaVersion: ROLE_PROFILE_SCHEMA_VERSION,
    role: role as CouncilRole,
    name,
    coreQuestion,
    lenses,
    notSuitableFor,
    sources,
  };
  const findings = scanRoleProfileContent(content);
  return findings.length ? { ok: false, errors: findings, ignoredFields } : { ok: true, content, ignoredFields };
}

/** The same scan as skill text (secrets, contact data, rule-override text) over every text of the profile. */
export function scanRoleProfileContent(content: RoleProfileContent): string[] {
  const all = [
    content.name,
    content.coreQuestion,
    ...content.lenses,
    content.notSuitableFor,
    ...content.sources.flatMap((s) => [s.title, s.url ?? "", s.note ?? ""]),
  ].join("\n");
  return scanSkillContent({ schemaVersion: SKILL_SCHEMA_VERSION, name: "", summary: "", category: "other", knowledge: all }).map((f) =>
    f.message.replace(/^The skill/, "The role profile").replace(/skills must not/, "role profiles must not"),
  );
}

/** Stable content hash (sha256 hex over JSON with sorted keys at every level). */
export function roleProfileContentHash(content: RoleProfileContent): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : isRecord(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sort(value[k])]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(sort(content)))
    .digest("hex");
}

const curated = (slug: string, content: Omit<RoleProfileContent, "schemaVersion">) => ({
  slug,
  version: 1,
  content: { schemaVersion: ROLE_PROFILE_SCHEMA_VERSION, ...content } as RoleProfileContent,
});

const OWN = (title: string): RoleProfileSource => ({ title, url: null, status: "own_statement", checkedAt: null, note: null });

/**
 * Five curated starting profiles, read-only. Written by the CONSYRION team as their own assessment: no real persons, no
 * quotes, no links – every source is labelled `own_statement`.
 */
export const CURATED_ROLE_PROFILES: ReadonlyArray<{ slug: string; version: number; content: RoleProfileContent }> = [
  curated("security-review", {
    role: "security_expert",
    name: "Security review",
    coreQuestion: "Who can do what with this system that they should not – and what stops them?",
    lenses: [
      "Authentication and session handling, including account recovery",
      "Tenant isolation: can one customer ever read or change another customer's data?",
      "Secrets: where keys live, who can read them, how they are rotated",
      "Abuse cases: automation, enumeration, cost exhaustion",
      "What is logged, and whether logs leak personal data or secrets",
    ],
    notSuitableFor: "Legal compliance sign-off or a penetration test; this perspective names risks, it does not certify.",
    sources: [OWN("Assessment of the CONSYRION team, without external source")],
  }),
  curated("architecture-fit", {
    role: "software_architect",
    name: "Architecture fit",
    coreQuestion: "Is this the simplest structure that meets the confirmed requirements and can be operated by this team?",
    lenses: [
      "Boundaries: which parts change together, which independently",
      "Failure modes of each dependency and what happens when it is down",
      "Data ownership: one source of truth per piece of data",
      "Operability for the stated team size",
      "Migration path from today's system and the first concrete step",
    ],
    notSuitableFor: "Detailed performance tuning or framework-level code review.",
    sources: [OWN("Assessment of the CONSYRION team, without external source")],
  }),
  curated("product-value", {
    role: "product_strategist",
    name: "Product value",
    coreQuestion: "Which user problem does this solve, and how would we notice that it does?",
    lenses: [
      "The concrete user and situation the decision is for",
      "What users do today instead, and what makes them switch",
      "The smallest version that shows whether it works",
      "A measurable signal of success and a point to stop",
    ],
    notSuitableFor: "Market sizing or pricing studies that need external data.",
    sources: [OWN("Assessment of the CONSYRION team, without external source")],
  }),
  curated("cost-control", {
    role: "cost_analyst",
    name: "Cost control",
    coreQuestion: "What does this cost per month at the expected load, and what makes the cost jump?",
    lenses: [
      "One-time versus recurring costs, kept apart",
      "Cost drivers that scale with users, data or requests",
      "Figures that are only vendor claims, marked as unconfirmed",
      "The cheapest option that still meets every confirmed requirement",
    ],
    notSuitableFor: "Tax, accounting or contract advice.",
    sources: [OWN("Assessment of the CONSYRION team, without external source")],
  }),
  curated("verification", {
    role: "quality_assurance_expert",
    name: "Verification",
    coreQuestion: "How will we know it works – and what would break without anyone noticing?",
    lenses: [
      "Automated tests that prove each confirmed requirement",
      "Edge cases: empty input, limits, concurrent changes",
      "Regression risk for existing behaviour",
      "Monitoring that shows a failure before users report it",
    ],
    notSuitableFor: "Formal certification or manual acceptance on behalf of the customer.",
    sources: [OWN("Assessment of the CONSYRION team, without external source")],
  }),
];

export function curatedRoleProfile(id: string) {
  return id.startsWith("curated:") ? (CURATED_ROLE_PROFILES.find((p) => `curated:${p.slug}` === id) ?? null) : null;
}
