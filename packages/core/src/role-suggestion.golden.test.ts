import { describe, expect, it } from "vitest";
import type { CouncilRole } from "./phases";
import { MODE_POLICIES } from "./policy";
import { suggestRoles } from "./role-suggestion";

/**
 * Golden set for the perspective suggestion (#269): ten projects with the roles a reviewer considers relevant for their
 * risk categories (written by hand, before looking at the output). Measured, without any model call:
 * - coverage: share of the relevant roles that are suggested,
 * - unfounded: suggested roles that are neither relevant nor always-on (security, critic) – roles without a reason.
 * Baseline: the default team of the Independent Expert mode (what the setup shows without a suggestion).
 */
const GOLDEN: Array<{ name: string; input: Parameters<typeof suggestRoles>[0]; relevant: CouncilRole[] }> = [
  {
    name: "SaaS pricing",
    input: {
      idea: "Neues Preismodell für unser SaaS-Abo",
      goal: "Mehr zahlende Kunden ohne Umsatzverlust",
      confirmed: [{ text: "Preis höchstens 9 € pro Monat" }],
    },
    relevant: ["cost_analyst", "product_strategist"],
  },
  {
    name: "Software security",
    input: { idea: "Login with passkeys and tenant isolation", confirmed: [{ text: "GDPR compliant storage of personal data" }] },
    relevant: ["security_expert", "software_architect"],
  },
  {
    name: "OnJam latency",
    input: {
      idea: "OnJam: Audio-Latenz beim Online-Jammen senken",
      confirmed: [{ text: "Latenz unter 30 ms zwischen zwei Musikern" }, { text: "Läuft auf dem bestehenden Server" }],
    },
    relevant: ["performance_engineer", "devops_engineer"],
  },
  {
    name: "Hiring",
    input: {
      idea: "Should we hire a second developer or use an agency?",
      goal: "Ship the MVP to customers within 3 months",
      requirements: "Budget at most 8000 EUR per month",
    },
    relevant: ["cost_analyst", "product_strategist"],
  },
  {
    name: "GDPR data export",
    input: { idea: "Datenexport für Kunden nach DSGVO", confirmed: [{ text: "Export enthält alle personenbezogenen Daten aus der Datenbank" }] },
    relevant: ["security_expert", "database_architect"],
  },
  {
    name: "Database migration",
    input: { idea: "Migrate from MySQL to Postgres", confirmed: [{ text: "No downtime longer than 5 minutes" }, { text: "All queries keep working" }] },
    relevant: ["database_architect", "devops_engineer"],
  },
  {
    name: "Mobile redesign",
    input: { idea: "Redesign the mobile dashboard", goal: "Users find their invoices faster", confirmed: [{ text: "Accessible (WCAG AA) and responsive" }] },
    relevant: ["frontend_engineer", "product_strategist"],
  },
  {
    name: "CI pipeline",
    input: { idea: "Move our CI/CD pipeline to Docker-based runners", confirmed: [{ text: "Every test suite runs on each pull request" }] },
    relevant: ["devops_engineer", "quality_assurance_expert"],
  },
  {
    name: "Legacy refactor",
    input: { idea: "Refactor the legacy billing module", goal: "Reduce technical debt", confirmed: [{ text: "Regression tests cover all invoice types" }] },
    relevant: ["maintainability_reviewer", "quality_assurance_expert", "cost_analyst"],
  },
  {
    name: "Public API",
    input: {
      idea: "Offer a public REST API with webhooks",
      confirmed: [{ text: "Rate limits per API token" }, { text: "Throughput of 500 requests per second" }],
    },
    relevant: ["backend_engineer", "security_expert", "performance_engineer"],
  },
];

const ALWAYS: CouncilRole[] = ["security_expert", "independent_critical_thinker"];

function measure(roles: readonly CouncilRole[], relevant: readonly CouncilRole[]) {
  const covered = relevant.filter((r) => roles.includes(r)).length;
  const unfounded = roles.filter((r) => !relevant.includes(r) && !ALWAYS.includes(r)).length;
  return { coverage: covered / relevant.length, unfounded, size: roles.length };
}

describe("perspective suggestion golden set (#269)", () => {
  const rows = GOLDEN.map((g) => {
    const suggested = suggestRoles(g.input).suggested.map((s) => s.role);
    return { name: g.name, suggestion: measure(suggested, g.relevant), baseline: measure(MODE_POLICIES.independent_expert.roles, g.relevant), suggested };
  });
  const avg = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0) / rows.length;

  it("covers the relevant roles better than the default team, never with more roles than the maximum", () => {
    // Printed so the numbers can be copied into the docs (docs/council-engine.md, "Golden set").
    console.table(
      rows.map((r) => ({
        project: r.name,
        coverage: `${Math.round(r.suggestion.coverage * 100)}% (default ${Math.round(r.baseline.coverage * 100)}%)`,
        unfounded: `${r.suggestion.unfounded} (default ${r.baseline.unfounded})`,
        roles: r.suggested.join(", "),
      })),
    );
    expect(avg((r) => r.suggestion.coverage)).toBeGreaterThan(avg((r) => r.baseline.coverage));
    expect(avg((r) => r.suggestion.coverage)).toBeGreaterThanOrEqual(0.9);
    expect(rows.every((r) => r.suggestion.size <= 6)).toBe(true);
    // Different projects lead to different teams – not the same list for everything.
    expect(new Set(rows.map((r) => [...r.suggested].sort().join())).size).toBeGreaterThanOrEqual(8);
  });

  it("keeps unfounded roles rare: on average at most one per project", () => {
    expect(avg((r) => r.suggestion.unfounded)).toBeLessThanOrEqual(1);
  });
});
