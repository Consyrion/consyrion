import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { RequirementIntake, type IntakeProposal } from "./requirement-intake";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

const texts = [
  "Die Lösung muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen.",
  "Alle Daten müssen ausschließlich in der Schweiz gespeichert werden.",
  "Alle automatisierten Tests müssen grün sein.",
];
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

describe("when a requirement can be checked (#245)", () => {
  it("classifies every confirmed requirement and sums it up – display only", () => {
    const html = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{
          ...base,
          current: true,
          latest: {
            version: 1,
            items: texts.map((text, i) => ({ id: `R${i + 1}`, text })),
            excluded: [],
            noHardRequirements: false,
            briefVersion: 1,
            confirmedAt: new Date(0).toISOString(),
          },
        }}
      />,
    );
    expect(html).toContain("1 vorab prüfbar · 1 nur nach Umsetzung messbar · 1 im Build geprüft");
    expect(html).toContain(">nur nach Umsetzung messbar<");
    expect(html).toContain(">im Build geprüft<");
    // The wording is shown unchanged.
    for (const text of texts) expect(html).toContain(text);
  });

  it("marks a requirement checkable before the start while editing", () => {
    const html = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{ ...base, items: [{ text: texts[1]!, candidateKey: "c1", source: { kind: "requirements" }, isNew: false, sourceGone: false }] }}
      />,
    );
    expect(html).toContain(">vorab prüfbar<");
  });

  it("a latency limit in ms is measurable only after implementation (owner decision 08.11.26, #249 variant A)", () => {
    const html = render(
      <RequirementIntake
        projectId="prj"
        canWrite
        proposal={{
          ...base,
          items: [
            { text: "Die Ende-zu-Ende-Latenz muss unter 30 ms liegen.", candidateKey: "c1", source: { kind: "requirements" }, isNew: false, sourceGone: false },
          ],
        }}
      />,
    );
    expect(html).not.toContain(">vorab prüfbar<");
  });
});
