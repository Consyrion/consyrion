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

  it("sets DISPUTED apart from UNKNOWN: own symbol, dashed frame, its own count, and a legend (#266)", () => {
    const disputed = {
      ...matrix,
      requirementGate: {
        ...matrix.requirementGate!,
        proposals: matrix.requirementGate!.proposals.map((g) =>
          g.proposalId === "pro_a"
            ? {
                ...g,
                requirements: [
                  g.requirements[0]!,
                  { requirementId: "req_2", status: "DISPUTED" as const, pass: ["par_b"], fail: ["par_x"], unknown: [], open: [], conflicts: [] },
                ],
              }
            : g,
        ),
      },
    };
    const html = render({ matrix: disputed });
    expect(html).toContain("≠</span> disputed");
    expect(html).toContain("1 confirm, 1 not met");
    expect(html).toContain("border-dashed");
    // UNKNOWN keeps its own look.
    expect(html).toContain("?</span> unconfirmed");
    expect(html).toContain('data-testid="heatmap-legend"');
  });

  it("offers search and 'problems only' from 20 requirements on, not below (#266 part B)", () => {
    expect(render()).not.toContain('data-testid="heatmap-filter"');
    const ids = Array.from({ length: 25 }, (_, i) => `req_${i + 1}`);
    const manyView = { ...view, requirementList: { version: 1, items: ids.map((id, i) => ({ id, text: `Requirement number ${i + 1}` })), excluded: [] } };
    const many = {
      ...matrix,
      requirementGate: {
        ...matrix.requirementGate!,
        proposals: matrix.requirementGate!.proposals.map((g) => ({
          ...g,
          requirements: ids.map((id, i) => ({
            requirementId: id,
            status: i === 3 ? ("FAIL" as const) : ("PASS" as const),
            pass: ["par_a"],
            fail: [],
            unknown: [],
            open: [],
            conflicts: [],
          })),
        })),
      },
    };
    const html = render({ view: manyView, matrix: many });
    expect(html).toContain('data-testid="heatmap-filter"');
    expect(html).toContain("Problems only");
    expect(html).toContain("25 of 25 shown");
  });

  it("the requirement table of the Evaluation tab speaks words, not raw codes (#266)", async () => {
    const { RequirementGateTable } = await import("./requirement-gate");
    const { messagesFor } = await import("@/i18n/all-messages");
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="UTC">
        <RequirementGateTable view={view} gate={matrix.requirementGate!} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("✓ erfüllt");
    expect(html).toContain("? unbestätigt");
    expect(html).toContain("Bestätigt von:");
    expect(html).not.toMatch(/>PASS</);
    expect(html).not.toContain("PASS:");
  });

  it("shows the criteria as one matrix and says when every proposal is blocked", () => {
    const html = render({ approvableIds: new Set(), recommendedId: null });
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

  it("reads a verdict without anything approvable as an idea check when the council was started as one (#597)", () => {
    const open: DashboardMatrix = {
      ...matrix,
      requirementGate: {
        ...matrix.requirementGate!,
        proposals: [
          { ...matrix.requirementGate!.proposals[1]!, proposalId: "pro_a" },
          {
            ...matrix.requirementGate!.proposals[1]!,
            feasibility: "fail" as const,
            requirements: matrix.requirementGate!.proposals[1]!.requirements.map((r) => ({ ...r, status: "FAIL" as const })),
          },
        ],
      },
    };
    const props = { matrix: open, outcome: { title: "Needs verification", tone: "warning" as const }, approvableIds: new Set<string>(), recommendedId: null };
    const idea = {
      kind: "favorite" as const,
      leaders: ["pro_a"],
      tiedWith: [],
      toClarify: ["req_2"],
      excluded: [{ proposalId: "pro_b", requirementIds: ["req_1", "req_2"] }],
    };
    const html = render({ ...props, outcomeKey: "needs_verification", idea });
    expect(html).toContain("Idea checked – favourite with open points");
    expect(html).toContain("Clarify before the next step");
    expect(html).toContain("R2 – Existing tests keep passing");
    expect(html).toContain("Proposal B – not met: R1, R2");
    expect(html).toContain("This is an idea check, not an approval");
    // The strict wording of an approval council is not shown on top of it.
    expect(html).not.toContain("No proposal can be approved");
    expect(html).not.toContain('data-testid="who-acts"');
    // An approval council keeps its verdict and now says who has to act and that the lock is a rule of the app.
    const strict = render({ ...props, outcomeKey: "needs_verification" });
    expect(strict).toContain("No proposal can be approved");
    expect(strict).toContain('data-testid="who-acts"');
    expect(strict).toContain("that is a rule of the app");
    expect(strict).not.toContain("Idea checked");
    // With an approvable proposal neither appears.
    expect(render()).not.toContain('data-testid="who-acts"');
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

describe("verdict hero – answer and reservations (QA 12.11.26)", () => {
  it("shows the recommended proposal's own answer in the hero", () => {
    const html = render({ answer: { title: "Ten topics", summary: "Start with tutorials.", recommendations: ["1) AI tutorials", "2) Science explained"] } });
    expect(html).toContain('data-testid="verdict-answer"');
    expect(html).toContain("The answer");
    expect(html).toContain("1) AI tutorials");
    expect(html).toContain("2) Science explained");
  });

  it("turns the green hero amber and says why when high objections against the recommendation are open", () => {
    const html = render({ caution: { openCritical: 1, openHigh: 2, lowConfidence: true } });
    expect(html).toContain('data-testid="verdict-caution"');
    // Critical ones named first and apart (ChatGPT review of #631).
    expect(html).toContain("1 critical objection and 2 high objections against this recommendation are still open, and confidence is low");
    expect(html).toContain('href="#key-disputes"');
    expect(html).toContain("lg:col-span-2 border-warning/60");
    expect(html).not.toContain("lg:col-span-2 border-success/60");
  });

  it("stays green without reservations", () => {
    const html = render({ caution: { openCritical: 0, openHigh: 0, lowConfidence: false } });
    expect(html).not.toContain('data-testid="verdict-caution"');
    expect(html).toContain("lg:col-span-2 border-success/60");
  });

  it("keeps the chosen answer in the hero after the human decided", () => {
    const decidedView = { ...view, approvals: [{ action: "approve", selectedProposalId: null, comment: null }] } as unknown as View;
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en}>
        <VerdictDashboard
          view={decidedView}
          matrix={matrix}
          outcome={{ title: "Recommended solution", tone: "success" }}
          reason={null}
          approvableIds={new Set(["pro_a"])}
          recommendedId="pro_a"
          answer={{ title: "Ten topics", summary: "", recommendations: ["1) AI tutorials"] }}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("The answer you chose");
    expect(html).toContain("1) AI tutorials");
  });
});
