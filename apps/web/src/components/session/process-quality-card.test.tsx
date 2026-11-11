import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import type { View } from "./helpers";
import { ProcessQualityCard } from "./process-quality-card";

const view = {
  proposals: [
    { id: "A", label: "A" },
    { id: "B", label: "B" },
  ],
  processQuality: {
    participation: { valid: 3, total: 4, percent: 75, shortfalls: [{ participantId: "o2", phases: [] }] },
    participationGroups: { valid: 3, total: 3 },
    convergence: { measurable: true, initial: 0.1, latest: 0.4, delta: 0.3, level: "strong", drift: [] },
    objections: { total: 3, survived: 2, refuted: 1, resolved: 0, open: 0, effects: { revised: 1, blocking: 1, none: 0 } },
    weight: {
      measurable: true,
      topGroupShare: 0.5,
      topGroupParticipantIds: ["o1", "o2"],
      groups: 3,
      changedWinner: true,
      weightedWinnerId: "A",
      unweightedWinnerId: "B",
    },
  },
} as unknown as View;

describe("#182 process quality card", () => {
  it("words every figure in the interface language and states its limits", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")}>
        <ProcessQualityCard view={view} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Prozessqualität");
    expect(html).toContain("3 von 4 Modellen");
    expect(html).toContain("3 von 3 unabhängigen Modellen");
    expect(html).toContain("Stark: Die Vorschläge haben sich deutlich angenähert");
    expect(html).toContain("nicht als Ursache bewiesen");
    expect(html).toContain("Die Stimmgewichte haben den Sieger entschieden: gewichtet Vorschlag A, mit gleichen Stimmen Vorschlag B");
    expect(html).toContain("kein Vergleich mit einem einzelnen Modell");
  });
});
