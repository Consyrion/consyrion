import { COUNCIL_ROLES, type CouncilRole } from "./phases";

/**
 * Suggested 12 Minds Council perspectives for one project (#269), derived deterministically from the brief and the
 * confirmed requirements – no model call, no cost. A suggestion only: the user applies it (or not) before the start;
 * nothing changes silently. Roles are perspectives, not votes – majorities stay counted per model.
 *
 * Fairness: a security/downside check and an independent critical perspective are always suggested; every other role
 * needs a topic in the project text, named in its reason. Roles not suggested say why.
 */

/** Topic words per role (English, German, French, Spanish stems; matched on word starts, case-insensitive). */
const TOPICS: Record<CouncilRole, string[]> = {
  software_architect: [
    "architect",
    "architektur",
    "monolith",
    "microservice",
    "micro-service",
    "modul",
    "integration",
    "scal",
    "skalier",
    "design",
    "système",
    "sistema",
  ],
  security_expert: [
    "secur",
    "sicherheit",
    "auth",
    "login",
    "passw",
    "gdpr",
    "dsgvo",
    "privacy",
    "datenschutz",
    "tenant",
    "mandant",
    "encrypt",
    "verschlüssel",
    "payment",
    "zahlung",
    "token",
    "permission",
    "berechtig",
    "sécurité",
    "seguridad",
  ],
  performance_engineer: [
    "perform",
    "latenc",
    "latenz",
    "speed",
    "schnell",
    "real-time",
    "realtime",
    "echtzeit",
    "throughput",
    "durchsatz",
    "load",
    "last",
    "audio",
    "stream",
    "jitter",
    "millisec",
    "ms ",
    "rapide",
    "rápid",
  ],
  backend_engineer: ["backend", "api", "server", "endpoint", "worker", "queue", "webhook", "service", "rest", "graphql"],
  frontend_engineer: [
    "frontend",
    "ui",
    "ux",
    "oberfläche",
    "interface",
    "page",
    "seite",
    "mobile",
    "handy",
    "react",
    "next.js",
    "css",
    "accessib",
    "barriere",
    "responsive",
    "dashboard",
  ],
  database_architect: [
    "database",
    "datenbank",
    "sql",
    "postgres",
    "mysql",
    "schema",
    "migration",
    "data model",
    "datenmodell",
    "index",
    "query",
    "abfrage",
    "base de données",
    "base de datos",
  ],
  devops_engineer: [
    "deploy",
    "docker",
    "kubernetes",
    "k8s",
    "pipeline",
    "ci/cd",
    "hosting",
    "cloud",
    "monitoring",
    "backup",
    "infrastru",
    "betrieb",
    "uptime",
    "verfügbar",
    "availability",
    "downtime",
    "ausfall",
    "rollback",
  ],
  cost_analyst: [
    "cost",
    "kosten",
    "price",
    "preis",
    "pricing",
    "budget",
    "billing",
    "abrechnung",
    "abo",
    "subscription",
    "eur",
    "€",
    "$",
    "coût",
    "coste",
    "precio",
    "prix",
  ],
  product_strategist: [
    "market",
    "markt",
    "customer",
    "kunde",
    "user",
    "nutzer",
    "growth",
    "wachstum",
    "launch",
    "mvp",
    "competit",
    "wettbewerb",
    "hiring",
    "einstell",
    "team",
    "client",
    "cliente",
  ],
  quality_assurance_expert: [
    "test",
    "qa",
    "quality",
    "qualität",
    "bug",
    "regression",
    "coverage",
    "abdeckung",
    "e2e",
    "playwright",
    "vitest",
    "qualité",
    "calidad",
  ],
  maintainability_reviewer: [
    "maintain",
    "wartbar",
    "wartung",
    "refactor",
    "legacy",
    "tech debt",
    "technical debt",
    "technische schuld",
    "readab",
    "lesbar",
    "documentation",
    "dokumentation",
    "clean",
  ],
  independent_critical_thinker: [],
};

/** Always suggested, whatever the project: a downside/security check and an independent critic. */
const ALWAYS: CouncilRole[] = ["security_expert", "independent_critical_thinker"];

export interface RoleSuggestion {
  role: CouncilRole;
  /** Topic words found in the brief or requirements (as written there). */
  matched: string[];
  /** Confirmed requirements that mention one of the topics, as R1, R2, … */
  requirements: string[];
  /** Suggested because the rule always includes it (security/critic), not because of a topic. */
  always: boolean;
}

export interface RoleSuggestionResult {
  suggested: RoleSuggestion[];
  /** Roles left out, with the words they would have needed – never hidden. */
  notSuggested: Array<{ role: CouncilRole }>;
}

export function suggestRoles(
  input: { idea?: string | null; goal?: string | null; requirements?: string | null; confirmed?: ReadonlyArray<{ text: string }> },
  options: { max?: number } = {},
): RoleSuggestionResult {
  const max = Math.max(ALWAYS.length + 1, Math.min(COUNCIL_ROLES.length, options.max ?? 6));
  const text = ` ${[input.idea, input.goal, input.requirements, ...(input.confirmed ?? []).map((r) => r.text)].filter(Boolean).join(" \n ")} `.toLowerCase();
  const confirmed = (input.confirmed ?? []).map((r, i) => ({ id: `R${i + 1}`, text: ` ${r.text.toLowerCase()} ` }));
  // Word start: preceded by a non-letter, so "ui" does not match "build" and "last" not "elastic". Returns the whole word
  // as written in the text (e.g. "latency" for the stem "latenc"), or null.
  const find = (haystack: string, word: string) => {
    // A topic word with a trailing space ("ms ") is a whole word: it must not swallow the next word ("ms inside").
    const whole = word.endsWith(" ");
    const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(whole ? `(^|[^\\p{L}])(${escaped})(?![\\p{L}])` : `(^|[^\\p{L}])(${escaped}[\\p{L}-]*)`, "u").exec(haystack);
    return m ? m[2]!.trim() : null;
  };
  const scored = COUNCIL_ROLES.map((role) => {
    const matched = [...new Set(TOPICS[role].map((w) => find(text, w)).filter((w): w is string => Boolean(w)))];
    const requirements = confirmed.filter((r) => TOPICS[role].some((w) => find(r.text, w))).map((r) => r.id);
    return { role, matched, requirements, always: ALWAYS.includes(role), score: matched.length + requirements.length * 2 };
  });
  const always = scored.filter((s) => s.always);
  const topical = scored
    .filter((s) => !s.always && s.score > 0)
    .sort((a, b) => b.score - a.score || COUNCIL_ROLES.indexOf(a.role) - COUNCIL_ROLES.indexOf(b.role))
    .slice(0, max - always.length);
  // Without any topic the architect is the neutral default third perspective.
  if (!topical.length) topical.push(scored.find((s) => s.role === "software_architect")!);
  const chosen = new Set([...topical, ...always].map((s) => s.role));
  const suggested = COUNCIL_ROLES.filter((r) => chosen.has(r)).map((role) => {
    const s = scored.find((x) => x.role === role)!;
    return { role, matched: s.matched, requirements: s.requirements, always: s.always };
  });
  return { suggested, notSuggested: COUNCIL_ROLES.filter((r) => !chosen.has(r)).map((role) => ({ role })) };
}

/** A role profile the setup may suggest (#269 on top of #270): workspace profiles and the curated ones. */
export interface SuggestableProfile {
  id: string;
  role: CouncilRole;
  visibility: "private" | "team" | "curated";
}

export interface ProfileSuggestion {
  role: CouncilRole;
  /** The suggested profile, or null when there is none or several of the workspace's own to choose from. */
  profileId: string | null;
  /** Number of workspace (own or team) profiles for this role – more than one means the user picks. */
  workspaceProfiles: number;
}

/**
 * One profile per suggested role, deterministic: exactly one workspace profile (own or team) → that one; none → the
 * curated profile of the role if there is one; several → none preselected (the user chooses). A profile only sharpens a
 * role's prompt – it never adds a model, a vote or a reviewer.
 */
export function suggestRoleProfiles(suggestion: RoleSuggestionResult, profiles: readonly SuggestableProfile[]): ProfileSuggestion[] {
  return suggestion.suggested.map(({ role }) => {
    const workspace = profiles.filter((p) => p.role === role && p.visibility !== "curated");
    const curated = profiles.filter((p) => p.role === role && p.visibility === "curated");
    const profileId = workspace.length === 1 ? workspace[0]!.id : workspace.length === 0 ? (curated[0]?.id ?? null) : null;
    return { role, profileId, workspaceProfiles: workspace.length };
  });
}

/**
 * Profiles after applying the suggestion (#269) to the role selection `roles` (the suggestion, or the current selection
 * plus the suggested roles it lacks): a suggested profile is set only for a role without a chosen profile – the user's
 * own choice is never overwritten – and profiles of roles that are no longer active are dropped.
 */
export function profilesAfterApply(
  roles: readonly CouncilRole[],
  profileSuggestions: readonly ProfileSuggestion[],
  currentProfiles: Partial<Record<CouncilRole, string>>,
): Partial<Record<CouncilRole, string>> {
  const profiles: Partial<Record<CouncilRole, string>> = {};
  for (const role of roles) {
    const chosen = currentProfiles[role] ?? profileSuggestions.find((p) => p.role === role)?.profileId ?? undefined;
    if (chosen) profiles[role] = chosen;
  }
  return profiles;
}

export const ROLE_SELECTION_VERSION = 1;

/**
 * Where an active role of a council came from. `coverage` = added so every model has a perspective (#136); `default` =
 * the mode's standard team, when the start named no roles (API, MCP, Telegram) – never shown as the user's own choice or
 * as an applied suggestion (the suggestion is still stored under `suggested`).
 */
export type RoleOrigin = "suggestion" | "skill" | "own" | "coverage" | "default";

/**
 * Frozen at the council start (#269, `council_session.role_selection`): what was suggested and why, and where each
 * active role came from. Computed on the server from the brief and the confirmed requirement list the council is bound
 * to – never taken from the client. The user's confirmation is the start itself (`createdById`, `createdAt`).
 */
export interface RoleSelectionSnapshot {
  version: typeof ROLE_SELECTION_VERSION;
  suggested: Array<RoleSuggestion & { profileId: string | null }>;
  notSuggested: CouncilRole[];
  roles: Array<{ role: CouncilRole; origin: RoleOrigin; profileId: string | null }>;
  /** Roles are perspectives, not votes: the number of independent models stays the number of participants. */
  models: number;
}

export function roleSelectionSnapshot(input: {
  suggestion: RoleSuggestionResult;
  profileSuggestions: readonly ProfileSuggestion[];
  /** Roles the user chose (before #136 coverage). */
  chosen: readonly CouncilRole[];
  /** All active roles of the council (chosen plus coverage). */
  active: readonly CouncilRole[];
  skillRoles?: readonly CouncilRole[] | null;
  /** Frozen role profiles: role → profile id. */
  profiles: Partial<Record<CouncilRole, string>>;
  models: number;
  /** False when the start named no roles and the mode's standard team was used (API/MCP/Telegram). Default true. */
  rolesChosen?: boolean;
}): RoleSelectionSnapshot {
  const suggested = new Set(input.suggestion.suggested.map((s) => s.role));
  const origin = (role: CouncilRole): RoleOrigin =>
    !input.chosen.includes(role)
      ? "coverage"
      : input.skillRoles?.includes(role)
        ? "skill"
        : input.rolesChosen === false
          ? "default"
          : suggested.has(role)
            ? "suggestion"
            : "own";
  return {
    version: ROLE_SELECTION_VERSION,
    suggested: input.suggestion.suggested.map((s) => ({ ...s, profileId: input.profileSuggestions.find((p) => p.role === s.role)?.profileId ?? null })),
    notSuggested: input.suggestion.notSuggested.map((r) => r.role),
    roles: input.active.map((role) => ({ role, origin: origin(role), profileId: input.profiles[role] ?? null })),
    models: input.models,
  };
}
