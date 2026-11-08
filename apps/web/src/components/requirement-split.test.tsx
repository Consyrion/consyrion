import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { RequirementIntake, type IntakeProposal } from "./requirement-intake";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const render = (node: ReactNode, locale: "de" | "en" = "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

const R1 = "Gesundheitsdaten nur in Deutschland, Verschlüsselung at rest und in transit, revisionssicherer Audit-Trail 10 Jahre.";
const base: IntakeProposal = {
  source: { hash: "h", briefVersion: 1, documents: [] },
  current: false,
  latest: null,
  items: [],
  excluded: [],
  toDecide: [],
  unscannedDocuments: [],
  notProposed: 0,
};

describe("requirement split in the intake (#216)", () => {
  it("shows the proposed parts next to the unchanged original – nothing is split before the user clicks", () => {
    const html = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{
          ...base,
          items: [
            {
              text: R1,
              candidateKey: "c1",
              source: { kind: "requirements" },
              isNew: false,
              sourceGone: false,
              decomposition: {
                kind: "split",
                parts: ["Gesundheitsdaten nur in Deutschland.", "Verschlüsselung at rest und in transit.", "revisionssicherer Audit-Trail 10 Jahre."],
              },
            },
            {
              text: "Bei Internetausfall 4 Stunden offline weiterarbeiten und danach synchronisieren, Doppelbuchungen verboten.",
              candidateKey: "c2",
              source: { kind: "requirements" },
              isNew: false,
              sourceGone: false,
              decomposition: { kind: "coupled" },
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Enthält 3 unabhängig prüfbare Teile:");
    expect(html).toContain("In 3 Teile aufteilen");
    expect(html).toContain("Ungeteilt lassen");
    expect(html).toContain("Zusammengehörige Bedingungen – werden als eine Anforderung geprüft.");
    // The original is still the one editable row (R1), the parts are only a proposal.
    expect(html).toContain(`>${R1}</textarea>`);
    expect(html.match(/<textarea/g)).toHaveLength(2);
  });

  it("names the origin of every confirmed part and links re-edited parts back to the original", () => {
    const parts = ["Gesundheitsdaten nur in Deutschland.", "Verschlüsselung at rest und in transit."];
    const confirmed = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{
          ...base,
          current: true,
          latest: {
            version: 2,
            items: parts.map((text, i) => ({ id: `R${i + 1}`, text, splitFrom: { text: R1, part: i + 1, of: 2 } })),
            excluded: [],
            noHardRequirements: false,
            briefVersion: 1,
            confirmedAt: new Date(0).toISOString(),
          },
        }}
      />,
      "en",
    );
    expect(confirmed).toContain(`Part a of 2 – from: “${R1}”`);
    expect(confirmed).toContain(`Part b of 2 – from: “${R1}”`);
    const editing = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{
          ...base,
          items: parts.map((text) => ({ text, candidateKey: "c1", source: { kind: "requirements" }, isNew: false, sourceGone: false, splitFrom: R1 })),
        }}
      />,
    );
    expect(editing).toContain("Teil b von 2 – aus:");
    expect(editing).toContain("Wieder zum Original zusammenführen");
    // "10 Jahre" is in the original but in no part: a warning, never a silent loss.
    expect(editing).toContain("Im Original steht 10");
  });
});
