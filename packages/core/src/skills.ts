import { createHash } from "node:crypto";
import { COUNCIL_ROLES, DECISION_MODES, validateWeights, type CouncilRole, type DecisionMode, type EvaluationWeights } from "./phases";
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS } from "./policy";

/**
 * Skills (#363): versioned decision packages that PRE-FILL a council setup – perspectives, requirement building blocks,
 * verdict weights, session rules and domain knowledge. A skill never decides anything: requirement blocks reach the
 * intake as proposals the user confirms, weights only rank qualified proposals, and skill text reaches the models as
 * untrusted data, never as instructions. Pure module (no I/O) except the content hash.
 */

export const SKILL_SCHEMA_VERSION = 1;

export const SKILL_CATEGORIES = ["architecture", "data_protection", "vendor", "security", "cost", "other"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_VISIBILITIES = ["private", "team"] as const;
export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

export const SKILL_LIMITS = {
  name: 80,
  summary: 400,
  requirementBlock: 300,
  requirementBlocks: 20,
  sessionRules: 2_000,
  knowledge: 8_000,
  changelog: 500,
} as const;

/** Origin of a duplicated skill (#422): the source and the exact version that was copied. */
export interface SkillForkRef {
  skillId: string;
  name: string;
  version: number;
  contentHash: string;
}

/**
 * Validates the optional changelog of a version (#422): a short plain text, scanned like the content (no secrets, no
 * contact data, no rule-override text). Returns null for an empty note.
 */
export function validateSkillChangelog(input: unknown): { ok: true; changelog: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, changelog: null };
  if (typeof input !== "string") return { ok: false, error: "changelog must be a text" };
  const changelog = input.trim().replace(/\s+/g, " ");
  if (!changelog) return { ok: true, changelog: null };
  if (changelog.length > SKILL_LIMITS.changelog) return { ok: false, error: `changelog is longer than ${SKILL_LIMITS.changelog} characters` };
  const findings = scanSkillContent({ schemaVersion: SKILL_SCHEMA_VERSION, name: changelog, summary: "", category: "other" });
  return findings.length ? { ok: false, error: `changelog: ${findings[0]!.message}` } : { ok: true, changelog };
}

export interface SkillContent {
  schemaVersion: typeof SKILL_SCHEMA_VERSION;
  name: string;
  summary: string;
  category: SkillCategory;
  /** Suggested council shape; the user can change everything before the start. */
  council?: { mode?: DecisionMode; models?: number };
  /** 12 Minds perspectives to pre-select. */
  roles?: CouncilRole[];
  /** Requirement proposals for the intake; `{gap}` marks a value the user fills in (e.g. "{amount} CHF"). */
  requirementBlocks?: string[];
  /** Final Verdict weights in percent (sum 100). */
  weights?: EvaluationWeights;
  /** Pre-filled free-text session rules. */
  sessionRules?: string;
  /** Reference text / checklist shown to the models as context (untrusted data). */
  knowledge?: string;
}

/** What a council session stores about the skill it was set up with (#363): enough to name and verify it later. */
/**
 * What a council stores about the skill it used (#363 part 3): the reference plus the knowledge text it showed the
 * models, frozen at the start – a later edit, archive or takedown of the skill never changes a past decision.
 */
export interface SkillSessionSnapshot extends SkillSessionRef {
  knowledge?: string;
}

export interface SkillSessionRef {
  /** `official:<slug>` for shipped skills, else the skill row id. */
  skillId: string;
  name: string;
  version: number;
  /** sha256 of the canonical JSON of the content (skillContentHash). */
  contentHash: string;
}

/** A field of the input that was not stored, with the reason (#419) – reported back instead of dropped silently. */
export interface IgnoredSkillField {
  path: string;
  reason: "unknown_field";
}

type Result =
  | { ok: true; content: SkillContent; ignoredFields: string[]; ignored: IgnoredSkillField[] }
  | { ok: false; errors: string[]; ignoredFields: string[]; ignored: IgnoredSkillField[]; newerSchemaVersion?: number };

const KNOWN_FIELDS = ["schemaVersion", "name", "summary", "category", "council", "roles", "requirementBlocks", "weights", "sessionRules", "knowledge"] as const;
const KNOWN_COUNCIL_FIELDS = ["mode", "models"] as const;
const WEIGHT_KEYS = ["technicalQuality", "security", "maintainability", "operatingCost", "implementationSpeed"] as const;

/** Message for a skill written for a later schema (#419): a clear "update CONSYRION" instead of a cryptic error. */
export function newerSkillSchemaMessage(schemaVersion: number) {
  return `This skill was created with a newer CONSYRION version (skill schema ${schemaVersion}); this installation reads schema ${SKILL_SCHEMA_VERSION}. Update CONSYRION to import it.`;
}

function unknownKeys(value: Record<string, unknown>, known: readonly string[], prefix = ""): IgnoredSkillField[] {
  return Object.keys(value)
    .filter((k) => !known.includes(k))
    .map((k) => ({ path: `${prefix}${k}`, reason: "unknown_field" as const }));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : null);

/**
 * Validates untrusted input (editor, import, API) into a SkillContent with trimmed strings and only known fields.
 * Unknown fields are not stored but reported in `ignoredFields` (#419); a known field with an invalid value stays a
 * validation error. A skill of a newer schema version is refused with a clear message (`newerSchemaVersion`).
 */
export function validateSkillContent(input: unknown): Result {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["A skill must be a JSON object"], ignoredFields: [], ignored: [] };
  const ignored = unknownKeys(input, KNOWN_FIELDS);
  if (isRecord(input.council)) ignored.push(...unknownKeys(input.council, KNOWN_COUNCIL_FIELDS, "council."));
  if (isRecord(input.weights)) ignored.push(...unknownKeys(input.weights, WEIGHT_KEYS, "weights."));
  const ignoredFields = ignored.map((f) => f.path);
  const sv = input.schemaVersion;
  if (typeof sv === "number" && Number.isInteger(sv) && sv > SKILL_SCHEMA_VERSION)
    return { ok: false, errors: [newerSkillSchemaMessage(sv)], ignoredFields, ignored, newerSchemaVersion: sv };
  if (sv !== undefined && sv !== SKILL_SCHEMA_VERSION) errors.push(`Unsupported schemaVersion (expected ${SKILL_SCHEMA_VERSION})`);
  const name = text(input.name);
  if (!name) errors.push("name is required");
  else if (name.length > SKILL_LIMITS.name) errors.push(`name is longer than ${SKILL_LIMITS.name} characters`);
  const summary = text(input.summary) ?? "";
  if (summary.length > SKILL_LIMITS.summary) errors.push(`summary is longer than ${SKILL_LIMITS.summary} characters`);
  const category = (input.category ?? "other") as SkillCategory;
  if (!SKILL_CATEGORIES.includes(category)) errors.push(`category must be one of ${SKILL_CATEGORIES.join(", ")}`);

  const content: SkillContent = { schemaVersion: SKILL_SCHEMA_VERSION, name: name ?? "", summary, category };

  if (input.council !== undefined) {
    if (!isRecord(input.council)) errors.push("council must be an object");
    else {
      const council: NonNullable<SkillContent["council"]> = {};
      if (input.council.mode !== undefined) {
        if (!DECISION_MODES.includes(input.council.mode as DecisionMode)) errors.push(`council.mode must be one of ${DECISION_MODES.join(", ")}`);
        else council.mode = input.council.mode as DecisionMode;
      }
      if (input.council.models !== undefined) {
        const n = input.council.models;
        if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_PARTICIPANTS || n > MAX_PARTICIPANTS)
          errors.push(`council.models must be an integer from ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS}`);
        else council.models = n;
      }
      if (Object.keys(council).length) content.council = council;
    }
  }
  if (input.roles !== undefined) {
    if (!Array.isArray(input.roles) || input.roles.some((r) => !COUNCIL_ROLES.includes(r as CouncilRole)))
      errors.push("roles must be a list of known perspectives");
    else if (input.roles.length) content.roles = [...new Set(input.roles as CouncilRole[])];
  }
  if (input.requirementBlocks !== undefined) {
    if (!Array.isArray(input.requirementBlocks) || input.requirementBlocks.some((b) => typeof b !== "string"))
      errors.push("requirementBlocks must be a list of texts");
    else {
      const blocks = (input.requirementBlocks as string[]).map((b) => b.trim()).filter(Boolean);
      if (blocks.length > SKILL_LIMITS.requirementBlocks) errors.push(`at most ${SKILL_LIMITS.requirementBlocks} requirement blocks`);
      if (blocks.some((b) => b.length > SKILL_LIMITS.requirementBlock))
        errors.push(`a requirement block is longer than ${SKILL_LIMITS.requirementBlock} characters`);
      if (blocks.length) content.requirementBlocks = [...new Set(blocks)];
    }
  }
  if (input.weights !== undefined) {
    if (!isRecord(input.weights)) errors.push("weights must be an object");
    else {
      const w = input.weights as Record<string, unknown>;
      const keys = WEIGHT_KEYS;
      if (keys.some((k) => typeof w[k] !== "number")) errors.push("weights need all five criteria as numbers");
      else {
        const weights = Object.fromEntries(keys.map((k) => [k, w[k] as number])) as unknown as EvaluationWeights;
        const weightErrors = validateWeights(weights);
        if (weightErrors.length) errors.push(...weightErrors.map((e) => `weights: ${e}`));
        else content.weights = weights;
      }
    }
  }
  const rules = input.sessionRules === undefined ? null : text(input.sessionRules);
  if (input.sessionRules !== undefined && rules === null) errors.push("sessionRules must be a text");
  else if (rules && rules.length > SKILL_LIMITS.sessionRules) errors.push(`sessionRules is longer than ${SKILL_LIMITS.sessionRules} characters`);
  else if (rules) content.sessionRules = rules;
  const knowledge = input.knowledge === undefined ? null : text(input.knowledge);
  if (input.knowledge !== undefined && knowledge === null) errors.push("knowledge must be a text");
  else if (knowledge && knowledge.length > SKILL_LIMITS.knowledge) errors.push(`knowledge is longer than ${SKILL_LIMITS.knowledge} characters`);
  else if (knowledge) content.knowledge = knowledge;

  if (errors.length) return { ok: false, errors, ignoredFields, ignored };
  const findings = scanSkillContent(content);
  return findings.length ? { ok: false, errors: findings.map((f) => f.message), ignoredFields, ignored } : { ok: true, content, ignoredFields, ignored };
}

/** JSON with sorted keys at every level – the same content always gives the same text, hence the same hash. */
export function canonicalSkillJson(content: SkillContent): string {
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
  return JSON.stringify(sort(content));
}

/** Stable content hash of a skill version (sha256 hex over the canonical JSON). */
export function skillContentHash(content: SkillContent): string {
  return createHash("sha256").update(canonicalSkillJson(content)).digest("hex");
}

/** The `{gap}` placeholders of a requirement block, in order (the user fills them in before confirming). */
export function skillBlockGaps(block: string): string[] {
  return [...block.matchAll(/\{([^{}]{1,40})\}/g)].map((m) => m[1]!.trim());
}

export interface SkillFinding {
  kind: "secret" | "personal_data" | "instruction";
  message: string;
}

/** Shared with the SkillHub publication check (`skill-publication-scan.ts`). */
export const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bcn[irs]_[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwort|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i,
];
/** Bounded local part and domain (RFC limits), so a long run of letters cannot cause quadratic backtracking. */
export const SKILL_EMAIL_PATTERN = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}/;
const EMAIL = SKILL_EMAIL_PATTERN;
/** Text that tries to steer the council's rules instead of describing the subject (#363 security rule 1). */
export const INSTRUCTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|above|prior|all|system)\b.{0,20}\b(?:instructions?|rules?|prompts?)\b/i,
  /\b(?:ignoriere|vergiss|missachte)\b.{0,40}\b(?:vorherigen?|obigen?|alle|system)\b.{0,20}\b(?:anweisungen|regeln|prompts?)\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(?:mark|treat|count|report|rate)\b.{0,40}\b(?:as\s+)?(?:pass(?:ed)?|met|satisfied|approved)\b.{0,30}\b(?:always|regardless|without)\b/i,
  /\b(?:skip|bypass|override|umgeh\w*|überspring\w*)\b.{0,40}\b(?:approval|freigabe|review|prüfung|gate|requirements?|anforderungen)\b/i,
  /\b(?:you are|du bist)\s+(?:now\s+|jetzt\s+)?(?:the\s+)?(?:system|admin|developer)\b/i,
];

/**
 * Checks skill text before it is stored (every save, import and – in V2 – publication): no secrets or personal contact
 * data, and nothing that tries to override the council's rules. Skill text stays untrusted data in any case.
 */
export function scanSkillContent(content: SkillContent): SkillFinding[] {
  const texts = [content.name, content.summary, ...(content.requirementBlocks ?? []), content.sessionRules ?? "", content.knowledge ?? ""];
  const all = texts.join("\n");
  const findings: SkillFinding[] = [];
  if (SECRET_PATTERNS.some((p) => p.test(all)))
    findings.push({ kind: "secret", message: "The skill contains something that looks like a key, token or password – remove it." });
  if (EMAIL.test(all)) findings.push({ kind: "personal_data", message: "The skill contains an e-mail address – skills must not carry personal contact data." });
  if (INSTRUCTION_PATTERNS.some((p) => p.test(all)))
    findings.push({
      kind: "instruction",
      message: "The skill contains text that tries to change the council's rules (e.g. ignore instructions, skip the approval). Describe the subject instead.",
    });
  return findings;
}

/** A YAML scalar in double quotes (JSON string escaping is valid YAML), so any name or summary stays one safe value. */
const yamlString = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

/**
 * Export as the two files of a skill folder: SKILL.md (human description) and skill.json (machine part). SKILL.md
 * starts with YAML frontmatter (name, description, version) generated from skill.json (#422) – skill.json stays the
 * only source, so the folder fits Claude/OpenClaw-style skill directories without a second truth.
 */
export function exportSkillFiles(
  content: SkillContent,
  meta: { version?: number; changelog?: ReadonlyArray<{ version: number; changelog: string }>; forkedFrom?: SkillForkRef | null } = {},
): { "SKILL.md": string; "skill.json": string } {
  const changes = (meta.changelog ?? []).filter((c) => c.changelog.trim());
  const lines = [
    "---",
    `name: ${yamlString(content.name)}`,
    `description: ${yamlString(content.summary || content.name)}`,
    ...(meta.version ? [`version: ${meta.version}`] : []),
    "---",
    "",
    `# ${content.name}`,
    "",
    content.summary,
    "",
    `- Category: ${content.category}${meta.version ? ` · Version ${meta.version}` : ""}`,
    ...(content.council?.mode ? [`- Mode: ${content.council.mode}`] : []),
    ...(content.council?.models ? [`- Models: ${content.council.models}`] : []),
    ...(content.roles?.length ? [`- Perspectives: ${content.roles.join(", ")}`] : []),
    ...(content.weights
      ? [
          `- Weights: ${Object.entries(content.weights)
            .map(([k, v]) => `${k} ${v} %`)
            .join(", ")}`,
        ]
      : []),
    ...(content.requirementBlocks?.length
      ? ["", "## Requirement building blocks (proposals – confirmed by the user)", "", ...content.requirementBlocks.map((b) => `- ${b}`)]
      : []),
    ...(content.sessionRules ? ["", "## Session rules", "", content.sessionRules] : []),
    ...(content.knowledge ? ["", "## Domain knowledge", "", content.knowledge] : []),
    ...(meta.forkedFrom
      ? ["", `Duplicated from ${meta.forkedFrom.name} (version ${meta.forkedFrom.version}, hash ${meta.forkedFrom.contentHash.slice(0, 12)}).`]
      : []),
    ...(changes.length ? ["", "## Changelog", "", ...changes.map((c) => `- Version ${c.version}: ${c.changelog}`)] : []),
    "",
  ];
  return { "SKILL.md": lines.join("\n"), "skill.json": `${JSON.stringify(content, null, 2)}\n` };
}

/** Import from a skill folder: skill.json is the source of truth (SKILL.md is only the readable description). */
export function importSkillJson(json: string): Result {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["skill.json is not valid JSON"], ignoredFields: [], ignored: [] };
  }
  return validateSkillContent(parsed);
}

/** Shipped, read-only skills (#363 V1). Versioned in code; the id is `official:<slug>`. */
export const OFFICIAL_SKILLS: ReadonlyArray<{ slug: string; version: number; content: SkillContent }> = [
  {
    slug: "architecture-review",
    version: 1,
    content: {
      schemaVersion: 1,
      name: "Architecture review",
      summary: "Compare software or hosting architectures against measurable limits for availability, latency, cost and team size.",
      category: "architecture",
      council: { mode: "adversarial_review", models: 3 },
      roles: ["software_architect", "devops_engineer", "security_expert", "cost_analyst", "independent_critical_thinker"],
      requirementBlocks: [
        "Availability must be at least {percent} % per month.",
        "The p95 response time must be below {milliseconds} ms.",
        "Total monthly infrastructure cost must not exceed {amount} {currency}.",
        "The system must be operable by {team size} developers without a dedicated operations team.",
      ],
      weights: { technicalQuality: 30, security: 25, maintainability: 20, operatingCost: 15, implementationSpeed: 10 },
      sessionRules:
        "Measured values given in the brief are fixed facts. Vendor statements without evidence do not count as met. Name the migration path and the first concrete step.",
    },
  },
  {
    slug: "data-protection-check",
    version: 1,
    content: {
      schemaVersion: 1,
      name: "Data protection check (GDPR / revDSG)",
      summary: "Check solutions that process personal data against data location, encryption, access logging and data processing agreements.",
      category: "data_protection",
      council: { mode: "adversarial_review", models: 3 },
      roles: ["security_expert", "software_architect", "database_architect", "independent_critical_thinker"],
      requirementBlocks: [
        "Personal data must be stored only in {region}.",
        "Data must be encrypted in transit and at rest.",
        "Every access to personal data must be logged and the logs kept for at least {days} days.",
        "Every processor needs a data processing agreement before go-live.",
      ],
      weights: { technicalQuality: 20, security: 40, maintainability: 15, operatingCost: 15, implementationSpeed: 10 },
      sessionRules:
        "Checklists and model judgements do not replace legal advice. Treat a missing data processing agreement as an open requirement, not as met.",
      knowledge:
        "Checklist: legal basis of processing, data minimisation, data location of every copy including backups, sub-processors and their locations, encryption keys and who holds them, retention and deletion, access logging for reading and changing data, breach notification process.",
    },
  },
  {
    slug: "vendor-comparison",
    version: 1,
    content: {
      schemaVersion: 1,
      name: "Vendor comparison",
      summary: "Choose between providers or products using fixed offers, measured values and contract terms instead of marketing claims.",
      category: "vendor",
      council: { mode: "independent_expert", models: 3 },
      roles: ["cost_analyst", "product_strategist", "security_expert", "independent_critical_thinker"],
      requirementBlocks: [
        "Total monthly cost including support must not exceed {amount} {currency}.",
        "The contract must allow termination within {months} months.",
        "The vendor must offer support in {language} during {hours}.",
      ],
      weights: { technicalQuality: 25, security: 20, maintainability: 15, operatingCost: 30, implementationSpeed: 10 },
      sessionRules:
        "Only figures from the offers count. A forecast or price range that crosses a limit is not confirmed. Name the deciding criterion for each rejected vendor.",
    },
  },
  {
    slug: "security-review",
    version: 1,
    content: {
      schemaVersion: 1,
      name: "Security review",
      summary: "Review a design or change for authentication, tenant isolation, secrets handling and abuse cases before it is built.",
      category: "security",
      council: { mode: "adversarial_review", models: 3 },
      roles: ["security_expert", "backend_engineer", "software_architect", "quality_assurance_expert", "independent_critical_thinker"],
      requirementBlocks: [
        "No user may read or change another tenant's data.",
        "Secrets must never appear in logs, error messages or the browser.",
        "Every administrative action must be logged with actor and time.",
      ],
      weights: { technicalQuality: 20, security: 45, maintainability: 15, operatingCost: 10, implementationSpeed: 10 },
      sessionRules: "Name the concrete attack path for every critical objection. A promised fix is not a mitigation until the proposal describes it.",
    },
  },
  {
    slug: "cost-decision",
    version: 1,
    content: {
      schemaVersion: 1,
      name: "Cost decision",
      summary: "Decide between options with a hard budget, separating one-time and recurring costs and making uncertain figures visible.",
      category: "cost",
      council: { mode: "independent_expert", models: 3 },
      roles: ["cost_analyst", "product_strategist", "independent_critical_thinker"],
      requirementBlocks: ["Recurring cost must not exceed {amount} {currency} per month.", "One-time cost must not exceed {amount} {currency}."],
      weights: { technicalQuality: 20, security: 15, maintainability: 15, operatingCost: 40, implementationSpeed: 10 },
      sessionRules: "Separate one-time and recurring costs. Ranges that cross a limit count as not confirmed. State what is excluded from each figure.",
    },
  },
];

export function officialSkill(id: string) {
  const slug = id.startsWith("official:") ? id.slice("official:".length) : null;
  return slug ? (OFFICIAL_SKILLS.find((s) => s.slug === slug) ?? null) : null;
}
