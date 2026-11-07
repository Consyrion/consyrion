import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../messages/session/de.json";
import en from "../../../messages/session/en.json";
import { localizeEngineText } from "./engine-text";

const translator = (messages: Record<string, unknown>, locale: string) => {
  const t = createTranslator({ locale, messages: messages as never, namespace: "engineText" as never });
  return (key: string, values?: Record<string, string | number>) => (t as unknown as (k: string, v?: unknown) => string)(key, values);
};
const tDe = translator(de, "de");
const tEn = translator(en, "en");

// Exactly as packages/council/src/phases.ts stores an objection decision (reviewer text + fixed parts).
const RESOLUTION =
  "Die Einwände sind durch die Proposal-Formulierung gedeckt. Conceded by the author – recorded as accepted until a revision fixes it (reviewer said: refuted). Addressed by the author in v2, v3. Not independently re-reviewed.";

describe("objection decisions in the interface language (night test 07.11.26)", () => {
  it("translates the fixed parts and keeps the reviewer's own words", () => {
    expect(localizeEngineText(RESOLUTION, tDe)).toBe(
      "Die Einwände sind durch die Proposal-Formulierung gedeckt. Vom Autor zugestanden – als angenommen festgehalten, bis eine Überarbeitung es behebt (Prüfer: widerlegt). Vom Autor in v2, v3 bearbeitet. Nicht unabhängig nachgeprüft.",
    );
    expect(localizeEngineText("No independent reviewer was available – provider error (timeout) for every eligible judge", tDe)).toBe(
      "Kein unabhängiger Prüfer verfügbar – provider error (timeout) bei jedem infrage kommenden Richter",
    );
    expect(localizeEngineText("Ok. (1 of 2 required independent reviews – no further judge was available)", tDe)).toBe(
      "Ok. (1 von 2 nötigen unabhängigen Prüfungen – kein weiterer Richter verfügbar)",
    );
    expect(
      localizeEngineText("Text. Content changed after the author conceded in v2 (not linked to this objection). Not independently re-reviewed.", tDe),
    ).toBe("Text. Inhalt nach dem Zugeständnis in v2 geändert (nicht mit diesem Einwand verknüpft). Nicht unabhängig nachgeprüft.");
  });

  it("leaves English unchanged in the English interface and unknown text as stored", () => {
    expect(localizeEngineText(RESOLUTION, tEn)).toBe(RESOLUTION);
    expect(localizeEngineText("Ein ganz eigener Text des Modells.", tDe)).toBe("Ein ganz eigener Text des Modells.");
  });
});
