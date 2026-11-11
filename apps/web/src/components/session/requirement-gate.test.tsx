import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import type { View } from "./helpers";
import { RequirementGateTable, type RequirementGateResult } from "./requirement-gate";

const view = {
  participants: [{ id: "par_a", provider: "openai", modelId: "gpt-5", status: "active" }],
  proposals: [{ id: "pro_a", label: "A", revisions: [] }],
  requirementList: { items: [{ id: "R3", text: "Availability at least 99.9 %" }] },
  requirementChecks: [],
} as unknown as View;

const gate = {
  proposals: [
    {
      proposalId: "pro_a",
      feasibility: "needs_verification",
      causes: [],
      requirements: [
        {
          requirementId: "R3",
          status: "UNKNOWN",
          pass: [],
          fail: [],
          unknown: ["par_a"],
          open: [],
          conflicts: [],
          estimate: { low: 99.85, high: 99.95, median: 99.9, evaluators: 2, limit: { direction: "min", value: 99.9, unit: "%" } },
        },
      ],
    },
  ],
  comparisonComplete: true,
  comparisonNote: null,
  summary: null,
} as unknown as RequirementGateResult;

// Gesamttest 3, finding 7: the estimate line showed the raw key "requirementGate.estimate" after the key became an object.
describe("requirement gate table: no raw message keys", () => {
  for (const locale of ["en", "de", "fr", "es", "zh"] as const) {
    it(`renders the estimate line in ${locale}`, () => {
      const errors: string[] = [];
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} timeZone="UTC" messages={messagesFor(locale)} onError={(e) => errors.push(e.message)}>
          <RequirementGateTable view={view} gate={gate} />
        </NextIntlClientProvider>,
      );
      expect(errors).toEqual([]);
      expect(html).not.toMatch(/requirementGate\.\w/);
      expect(html).toContain("99.85");
    });
  }
});
