import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import type { View } from "./helpers";
import { score1, VerdictDashboard, type DashboardMatrix } from "./verdict-dashboard";

const view = {
  session: { id: "s1", status: "awaiting_approval" },
  participants: [
    { id: "par_a", provider: "anthropic", modelId: "claude-haiku-5-5", status: "active" },
    { id: "par_b", provider: "openai", modelId: "gpt-5-mini", status: "active" },
  ],
  proposals: [
    { id: "pro_a", label: "A", authorParticipantId: "par_a", revisions: [] },
    { id: "pro_b", label: "B", authorParticipantId: "par_b", revisions: [] },
  ],
  objections: [{ id: "o1", proposalId: "pro_b", severity: "critical", status: "accepted", claim: "Tenant data can leak", moot: null }],
  approvals: [],
  requirementList: {
    version: 1,
    items: [
      { id: "req_1", text: "Runs on Node 22" },
      { id: "req_2", text: "Existing tests keep passing" },
    ],
    excluded: [],
  },
} as unknown as View;

const matrix: DashboardMatrix = {
  weights: { technicalQuality: 30, security: 25, maintainability: 20, operatingCost: 15, implementationSpeed: 10 },
  proposals: [
    { proposalId: "pro_a", total: 8.21, criterionMeans: { technicalQuality: 8, security: 8.5 }, independentEvaluators: 2, eligible: true },
    { proposalId: "pro_b", total: 9.04, criterionMeans: { technicalQuality: 9, security: 9 }, independentEvaluators: 2, eligible: true },
  ],
  requirementGate: {
    comparisonComplete: true,
    comparisonNote: null,
    summary: null,
    proposals: [
      {
        proposalId: "pro_a",
        feasibility: "qualified",
        causes: [],
        requirements: [
          { requirementId: "req_1", status: "PASS", pass: ["par_b"], fail: [], unknown: [], open: [], conflicts: [] },
          { requirementId: "req_2", status: "PASS", pass: ["par_b"], fail: [], unknown: [], open: [], conflicts: [] },
        ],
      },
      {
        proposalId: "pro_b",
        feasibility: "needs_verification",
        causes: ["R2 not confirmed"],
        requirements: [
          { requirementId: "req_1", status: "PASS", pass: ["par_a"], fail: [], unknown: [], open: [], conflicts: [] },
          { requirementId: "req_2", status: "UNKNOWN", pass: [], fail: [], unknown: ["par_a"], open: [], conflicts: [] },
        ],
      },
    ],
  },
};

const render = (extra: Record<string, unknown> = {}, messages: Record<string, unknown> = en) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VerdictDashboard
      view={view}
      matrix={matrix}
      outcome={{ title: "Recommended solution", tone: "success" }}
      reason={null}
      approvableIds={new Set(["pro_a"])}
      recommendedId="pro_a"
      {...extra}
    />
    </NextIntlClientProvider>,
  );

describe("verdict dashboard (stage 1 visualisations)", () => {
  it("shows scores with one decimal and never as false precision", () => {
    expect(score1(8.54)).toBe("8.5");
    expect(score1(8.55)).toBe("8.6");
    expect(score1(null)).toBe("–");
    const html = render();
    expect(html).toContain("8.2");
    expect(html).toContain("9.0");
    expect(html).not.toContain("8.21");
  });

  it("marks a higher-scoring proposal that misses a requirement as not approvable, with words, not only colour", () => {
    const html = render();
    expect(html).toContain("Proposal B: 9.0 of 10, not approvable");
    expect(html).toMatch(/<svg aria-hidden="true"[^>]*>.*?<\/svg> not approvable/);
    // No hatching any more (design review 05.11.26): blocked bars are a calm neutral fill.
    expect(html).not.toContain("repeating-linear-gradient");
    expect(html).toContain("bg-muted/35");
    expect(html).toContain("✓ recommended");
  });

  it("draws the requirement × proposal table with icon, word and evaluator counts", () => {
    const html = render();
    expect(html).toContain("R2");
    expect(html).toContain("unconfirmed");
    expect(html).toContain("0 of 1 confirm");
    // "met" appears once per cell, not twice (owner finding 05.11.26).
    expect(html).not.toContain("1/1 met");
    expect(html).toContain("claude-haiku-5-5: unconfirmed");
  });

  it("shows the criteria as one matrix and says when every proposal is blocked", () => {
    const html = render({ approvableIds: new Set() , recommendedId: null });
    expect(html).toContain("Criterion");
    expect(html).toContain("All 2 proposals are not approvable");
  });

  it("counts open objections by severity per proposal", () => {
    const html = render();
    expect(html).toContain("1 critical");
    expect(html).toContain("Tenant data can leak");
  });

  it("shows who wrote and who evaluated each proposal, and the review facts (#266)", () => {
    const html = render();
    expect(html).toContain("by claude-haiku-5-5 · evaluated by gpt-5-mini");
    expect(html).toContain("Review facts");
    expect(html).toContain("Critical/high objections open");
    expect(html).toContain("1 proposal can be approved");
  });

  it("links the one next step to the decision form only while the owner can decide", () => {
    expect(render()).not.toContain("#your-decision");
    const html = render({ nextAction: "approve", outcomeKey: "recommended" });
    expect(html).toContain('href="#your-decision"');
    expect(html).toContain("Next step: approve the recommendation");
  });

  it("speaks the reader's language", async () => {
    const de = (await import("../../../messages/de.json")).default;
    const html = render({ outcomeKey: "needs_verification" }, de);
    expect(html).toContain("Prüfung nötig – nicht freigebbar");
    expect(html).toContain("Gesamtpunktzahl");
    expect(html).toContain("unbestätigt");
  });
});

describe("gate before score (#266)", () => {
  it("shows the requirement check before any score", () => {
    const html = render();
    const gateAt = html.indexOf("Runs on Node 22");
    const scoreAt = html.indexOf("Proposal B: 9.0 of 10");
    expect(gateAt).toBeGreaterThan(-1);
    expect(scoreAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(scoreAt);
  });

  it("puts the gate status beside every score, so a higher score never reads as passed", () => {
    const html = render();
    const chips = [...html.matchAll(/data-testid="gate-status">([^<]+)</g)].map((m) => m[1]);
    // Sorted by score: B (9.0, needs verification) first, then A (8.2, qualified).
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatch(/verification/i);
    expect(html).toMatch(/text-warning"[^>]*data-testid="gate-status"/);
  });
});

describe("requirements no proposal meets (night test 07.11.26)", () => {
  it("names them in the hero when nothing can be approved", () => {
    const failAll: DashboardMatrix = {
      ...matrix,
      requirementGate: {
        ...matrix.requirementGate!,
        proposals: matrix.requirementGate!.proposals.map((g) => ({
          ...g,
          feasibility: "fail" as const,
          requirements: g.requirements.map((r) => ({ ...r, status: "FAIL" as const })),
        })),
      },
    };
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en}>
        <VerdictDashboard
          view={view}
          matrix={failAll}
          outcome={{ title: "No solution", tone: "danger" }}
          reason={null}
          approvableIds={new Set()}
          recommendedId={null}
          nextAction="request_changes"
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("No proposal meets R1, R2. These requirements may contradict each other");
    expect(html).toContain('data-next-action="request_changes"');
    // With an approvable proposal the hint stays away.
    expect(render()).not.toContain("No proposal meets");
  });

  it("names a requirement every proposal leaves unconfirmed (R2-02, 08.11.26)", () => {
    const openAll: DashboardMatrix = {
      ...matrix,
      requirementGate: {
        ...matrix.requirementGate!,
        proposals: matrix.requirementGate!.proposals.map((g) => ({
          ...g,
          feasibility: "needs_verification" as const,
          requirements: g.requirements.map((r, i) => ({ ...r, status: i === 0 ? ("PASS" as const) : ("UNKNOWN" as const) })),
        })),
      },
    };
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en}>
        <VerdictDashboard
          view={view}
          matrix={openAll}
          outcome={{ title: "Needs verification", tone: "warning" }}
          reason={null}
          approvableIds={new Set()}
          recommendedId={null}
          nextAction="request_changes"
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Confirmed for no proposal: R2.");
    expect(html).not.toContain("No proposal meets");
    expect(render()).not.toContain("Confirmed for no proposal");
  });
});
