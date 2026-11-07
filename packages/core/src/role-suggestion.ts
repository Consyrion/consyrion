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
  software_architect: ["architect", "architektur", "monolith", "microservice", "micro-service", "modul", "integration", "scal", "skalier", "design", "système", "sistema"],
  security_expert: ["secur", "sicherheit", "auth", "login", "passw", "gdpr", "dsgvo", "privacy", "datenschutz", "tenant", "mandant", "encrypt", "verschlüssel", "payment", "zahlung", "token", "permission", "berechtig", "sécurité", "seguridad"],
  performance_engineer: ["perform", "latenc", "latenz", "speed", "schnell", "real-time", "realtime", "echtzeit", "throughput", "durchsatz", "load", "last", "audio", "stream", "jitter", "millisec", "ms ", "rapide", "rápid"],
  backend_engineer: ["backend", "api", "server", "endpoint", "worker", "queue", "webhook", "service", "rest", "graphql"],
  frontend_engineer: ["frontend", "ui", "ux", "oberfläche", "interface", "page", "seite", "mobile", "handy", "react", "next.js", "css", "accessib", "barriere", "responsive", "dashboard"],
  database_architect: ["database", "datenbank", "sql", "postgres", "mysql", "schema", "migration", "data model", "datenmodell", "index", "query", "abfrage", "base de données", "base de datos"],
  devops_engineer: ["deploy", "docker", "kubernetes", "k8s", "pipeline", "ci/cd", "hosting", "cloud", "monitoring", "backup", "infrastru", "betrieb", "uptime", "verfügbar", "availability"],
  cost_analyst: ["cost", "kosten", "price", "preis", "pricing", "budget", "billing", "abrechnung", "abo", "subscription", "eur", "€", "$", "coût", "coste", "precio", "prix"],
  product_strategist: ["market", "markt", "customer", "kunde", "user", "nutzer", "growth", "wachstum", "launch", "mvp", "competit", "wettbewerb", "hiring", "einstell", "team", "client", "cliente"],
  quality_assurance_expert: ["test", "qa", "quality", "qualität", "bug", "regression", "coverage", "abdeckung", "e2e", "playwright", "vitest", "qualité", "calidad"],
  maintainability_reviewer: ["maintain", "wartbar", "wartung", "refactor", "legacy", "tech debt", "technical debt", "technische schuld", "readab", "lesbar", "documentation", "dokumentation", "clean"],
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
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|[^\\p{L}])(${escaped}[\\p{L}-]*)`, "u").exec(haystack);
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
