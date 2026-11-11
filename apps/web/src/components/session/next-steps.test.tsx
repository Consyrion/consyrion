import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import type { View } from "./helpers";
import { NextStepsCard } from "./next-steps-card";
import { deriveNextSteps } from "./next-steps";

const content = (over: Record<string, unknown>) => ({
  title: "T",
  summary: "S",
  architecture: "",
  components: [],
  advantages: [],
  disadvantages: [],
  risks: [],
  costEstimate: "",
  assumptions: [],
  recommendations: [],
  confidence: 0.7,
  ...over,
});

const view = {
  participants: [{ id: "par_x", provider: "openai", modelId: "gpt-5-mini", status: "active" }],
  proposals: [
    {
      id: "pro_a",
      label: "A",
      revisions: [
        {
          version: 1,
          content: content({
            assumptions: ["Users accept a 2 s delay"],
            risks: [
              { risk: "Provider rate limits", severity: "high", mitigation: "Queue with backoff" },
              { risk: "Minor UI glitch", severity: "low", mitigation: "" },
            ],
          }),
        },
      ],
    },
    { id: "pro_b", label: "B", revisions: [{ version: 1, content: content({}) }] },
  ],
  objections: [
    {
      id: "o1",
      proposalId: "pro_a",
      severity: "critical",
      status: "accepted",
      claim: "Tenant data can leak",
      evidence: "The cache key has no tenant id",
      raisedByParticipantId: "par_x",
    },
    { id: "o2", proposalId: "pro_a", severity: "high", status: "refuted", claim: "Too slow" },
  ],
  requirementList: {
    version: 1,
    items: [
      { id: "req_1", text: "Runs on Node 22" },
      { id: "req_2", text: "Existing tests keep passing" },
    ],
    excluded: [],
  },
  consensus: { disagreements: ["Whether caching is needed"] },
} as unknown as View;

const gate = {
  comparisonComplete: true,
  comparisonNote: null,
  summary: null,
  proposals: [
    {
      proposalId: "pro_a",
      feasibility: "needs_verification" as const,
      causes: [],
      requirements: [
        { requirementId: "req_1", status: "PASS" as const, pass: ["x"], fail: [], unknown: [], open: [], conflicts: [] },
        { requirementId: "req_2", status: "UNKNOWN" as const, pass: [], fail: [], unknown: ["x"], open: [], conflicts: [] },
      ],
    },
  ],
};

describe("next steps (#273): stored statements only", () => {
  it("lists unconfirmed requirements, open objections, assumptions, serious risks and open points", () => {
    const steps = deriveNextSteps(view, "pro_a", gate)!;
    expect(steps.verify).toEqual([{ id: "R2", text: "Existing tests keep passing", status: "UNKNOWN" }]);
    expect(steps.objections.map((o) => o.claim)).toEqual(["Tenant data can leak"]); // refuted one is not open
    expect(steps.assumptions).toEqual(["Users accept a 2 s delay"]);
    expect(steps.stopIf).toEqual([{ risk: "Provider rate limits", mitigation: "Queue with backoff" }]); // low risk left out
    expect(steps.revisitWhen).toEqual(["Whether caching is needed"]);
  });

  it("lists an open measurement check as open until a recorded measurement of this verdict meets it (Gesamttest 08.11.26)", () => {
    const measuring = {
      ...gate,
      proposals: gate.proposals.map((p) => ({
        ...p,
        requirements: [
          { requirementId: "req_1", status: "PASS" as const, measurementPending: true, pass: ["x"], fail: [], unknown: [], open: [], conflicts: [] },
        ],
      })),
    };
    const open = deriveNextSteps(view, "pro_a", measuring as never)!;
    expect(open.verify).toEqual([{ id: "R1", text: expect.any(String), status: "MEASURE" }]);
    const withMeasure = (met: boolean[]) =>
      ({
        ...view,
        decision: { id: "dec_1" },
        measurements: met.map((m, i) => ({ id: `m${i}`, decisionId: "dec_1", proposalId: "pro_a", requirementId: "req_1", met: m })),
      }) as never;
    expect(deriveNextSteps(withMeasure([true]), "pro_a", measuring as never)!.verify).toEqual([]);
    // One measured miss stays decisive.
    expect(deriveNextSteps(withMeasure([true, false]), "pro_a", measuring as never)!.verify).toHaveLength(1);
  });

  it("says 'not specified' instead of inventing, and names the situation when nothing is approvable", () => {
    const steps = deriveNextSteps({ ...view, consensus: null } as unknown as View, "pro_b", gate)!;
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <NextStepsCard view={view} steps={steps} mode="blocked" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("No proposal can be approved yet");
    expect(html).toContain("Not specified by the author.");
    expect(html).toContain("no open disagreement recorded");
    expect(deriveNextSteps(view, null, gate)).toBeNull();
  });
});

describe("next steps stage 1 (#273): counter-position and 'not yet', stored data only", () => {
  it("takes the strongest open or upheld objection as the counter-position, with its own reasoning", () => {
    const steps = deriveNextSteps(view, "pro_a", gate)!;
    expect(steps.counter).toMatchObject({
      claim: "Tenant data can leak",
      evidence: "The cache key has no tenant id",
      status: "accepted",
      severity: "critical",
    });
    // A refuted objection is never the counter-position; a proposal without objections has none.
    expect(deriveNextSteps(view, "pro_b", gate)!.counter).toBeNull();
  });

  it("shows it with 'would be right if', and says nothing can be approved or built while blocked", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <NextStepsCard view={view} steps={deriveNextSteps(view, "pro_a", gate)!} mode="blocked" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Strongest counter-position");
    expect(html).toContain("It would be right if this reasoning holds: The cache key has no tenant id");
    expect(html).toContain("Nothing can be approved or built yet");
    const recommended = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <NextStepsCard view={view} steps={deriveNextSteps(view, "pro_b", gate)!} mode="recommended" />
      </NextIntlClientProvider>,
    );
    expect(recommended).toContain("Kein offener oder bestätigter Einwand gegen diesen Vorschlag.");
    expect(recommended).not.toContain("Noch kann nichts freigegeben");
  });
});

describe("next steps stage 2 (#273): the author's test, stop criteria and revisit triggers", () => {
  const withFields = {
    ...view,
    proposals: [
      {
        id: "pro_c",
        label: "C",
        revisions: [
          {
            version: 1,
            content: content({
              cheapestTest: {
                assumption: "Teams accept tags instead of folders",
                method: "Two-week trial with one team",
                successCriterion: "80 % of new tasks get a tag",
              },
              stopCriteria: ["Search gets slower than 300 ms", " "],
              revisitTriggers: ["More than 50 teams"],
            }),
          },
        ],
      },
      ...view.proposals,
    ],
  } as unknown as View;

  it("takes the fields as written, drops empty ones and marks them as the author's AI suggestion", () => {
    const steps = deriveNextSteps(withFields, "pro_c", gate)!;
    expect(steps.cheapestTest).toEqual({
      assumption: "Teams accept tags instead of folders",
      method: "Two-week trial with one team",
      successCriterion: "80 % of new tasks get a tag",
    });
    expect(steps.stopCriteria).toEqual(["Search gets slower than 300 ms"]);
    expect(steps.revisitTriggers).toEqual(["More than 50 teams"]);
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <NextStepsCard view={withFields} steps={steps} mode="recommended" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Cheapest useful test");
    expect(html).toContain("a plan, not a confirmed check");
    expect(html).toContain("Confirmed if: 80 % of new tasks get a tag");
    expect(html).toContain('Search gets slower than 300 ms <span class="text-muted">(AI suggestion)</span>');
  });

  it("says 'not stated' for proposals written before stage 2, never inventing a test", () => {
    const steps = deriveNextSteps(view, "pro_a", gate)!;
    expect(steps.cheapestTest).toBeNull();
    expect(steps.stopCriteria).toEqual([]);
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <NextStepsCard view={view} steps={steps} mode="recommended" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Vom Autor nicht angegeben.");
  });
});
