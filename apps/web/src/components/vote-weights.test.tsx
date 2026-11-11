import { voteWeightWarnings } from "@consyrium/core";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { VoteWeights, weightShares, type VoteWeightRow } from "./vote-weights";

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

/** What the server preview returns for these rows (#189: the rule runs on the server, the component only shows it). */
const serverWarnings = (rows: VoteWeightRow[]) => voteWeightWarnings(rows.map((r) => ({ model: r.name, weight: r.weight, suggestion: r.suggestion })));

const known = {
  tier: 8,
  status: "known" as const,
  sourceModel: "Test Model",
  rawScore: 60,
  source: "Test ranking",
  sourceUrl: "https://example.test",
  fetchedAt: "2026-10-27T00:00:00.000Z",
};

describe("vote weights before the run (#141)", () => {
  it("shows shares that always add up to 100 %", () => {
    expect(weightShares([10, 8, 4])).toEqual([46, 36, 18]);
    expect(weightShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(weightShares([5, 5, 5, 5, 5, 5]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("names the suggestion with source and date, marks unknown, stale and adjusted models", () => {
    const rows: VoteWeightRow[] = [
      { key: "a", name: "Strong model", weight: 8, suggestion: known },
      { key: "b", name: "Changed model", weight: 3, suggestion: { ...known, tier: 6, status: "stale" } },
      { key: "c", name: "New model", weight: 5, suggestion: { ...known, tier: 5, status: "unknown", sourceModel: null, rawScore: null } },
    ];
    const html = render(<VoteWeights rows={rows} warnings={serverWarnings(rows)} onChange={() => {}} onSuggest={() => {}} onEqual={() => {}} />);
    expect(html).toContain('AI suggestion <strong class="text-text">8/10</strong> · Test ranking: Test Model (Oct 27, 2026)');
    expect(html).toContain("ranking older than 7 days");
    expect(html).toContain("Not in Test ranking (Oct 27, 2026) – neutral 5");
    expect(html.match(/>adjusted</g)).toHaveLength(1);
    expect(html).toContain("50 %");
    expect(html).toContain("Use AI suggestion");
    expect(html).toContain("All equal");
    expect(html).toContain('aria-valuetext="8 of 10, 50 percent of the vote"');
    expect(html).not.toContain("dominant vote share");
  });

  it("warns when one model holds more than half of the vote or deviates far from the suggestion (#170)", () => {
    const rows: VoteWeightRow[] = [
      { key: "a", name: "Weak model", weight: 10, suggestion: { ...known, tier: 3 } },
      { key: "b", name: "Strong model", weight: 1, suggestion: { ...known, tier: 9 } },
      { key: "c", name: "New model", weight: 1, suggestion: { ...known, tier: 5, status: "unknown", sourceModel: null, rawScore: null } },
    ];
    const html = render(<VoteWeights rows={rows} warnings={serverWarnings(rows)} onChange={() => {}} onSuggest={() => {}} onEqual={() => {}} />);
    expect(html).toContain("Weak model holds 83 % of the vote and outweighs all other models together.");
    expect(html).toContain(">dominant vote share<");
    expect(html).toContain("Weak model has weight 10, the ranking suggests 3.");
    expect(html).toContain("Strong model has weight 1, the ranking suggests 9.");
    expect(html).not.toContain("New model has weight");
    expect(html.match(/>far from suggestion</g)).toHaveLength(2);
  });
});
