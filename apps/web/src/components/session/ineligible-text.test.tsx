import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { useIneligibleReason, useReadableFormula, type View } from "./helpers";

function Probe({ reasons, formula }: { reasons: string[]; formula: string }) {
  const reason = useIneligibleReason();
  const readable = useReadableFormula();
  const view = { participants: [{ id: "par_1", modelId: "claude-x" }] } as unknown as View;
  return (
    <p>
      {reasons.map(reason).join("|")}#{readable(view, formula, { technicalQuality: 60, security: 40 }, (c) => c)}
    </p>
  );
}

const render = (locale: "de" | "en", reasons: string[], formula: string) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      <Probe reasons={reasons} formula={formula} />
    </NextIntlClientProvider>,
  );

describe("ineligibility reasons and formula in the interface language (text audit 08.11.26)", () => {
  it("rebuilds the verdict's known reasons in German", () => {
    const html = render(
      "de",
      [
        "Not qualified: R2 not confirmed: 1 of 2 evaluators could not confirm it.",
        "Not qualified: The author states that this proposal does not meet every requirement (not decisive on its own).",
        "2 unresolved blocking objection(s)",
        "Total 5.2 below minimum 6",
        "Something new",
      ],
      'total = Σ vote-weighted mean_independent_score(criterion) × weight(criterion) / 100; weights {"technicalQuality":60}; evaluator vote weights {"par_1":2}',
    );
    expect(html).toContain("Nicht qualifiziert: R2 nicht bestätigt: 1 von 2 Bewertern konnten sie nicht bestätigen.");
    expect(html).toContain("Nicht qualifiziert: Laut Autor erfüllt dieser Vorschlag nicht jede Anforderung (allein nicht entscheidend).");
    expect(html).toContain("2 blockierende Einwände sind noch offen");
    expect(html).toContain("Gesamtwert 5.2 liegt unter dem Minimum von 6");
    expect(html).toContain("Something new");
    expect(html).toContain("stimmgewichtetem Durchschnitt");
    expect(html).toContain("technicalQuality 60 %, security 40 %");
    expect(html).toContain("Stimmgewichte: claude-x ×2");
    expect(html).not.toContain("mean_independent_score");
  });
});
