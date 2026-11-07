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
    { id: "o1", proposalId: "pro_a", severity: "critical", status: "accepted", claim: "Tenant data can leak" },
    { id: "o2", proposalId: "pro_a", severity: "high", status: "refuted", claim: "Too slow" },
  ],
  requirementList: { version: 1, items: [{ id: "req_1", text: "Runs on Node 22" }, { id: "req_2", text: "Existing tests keep passing" }], excluded: [] },
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
