import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { useGateText } from "./helpers";

function Probe({ summary, cause }: { summary: string; cause: string }) {
  const gate = useGateText();
  return (
    <p>
      {gate.summary(summary)}|{gate.cause(cause)}
    </p>
  );
}

const render = (locale: "de" | "en", summary: string, cause: string) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      <Probe summary={summary} cause={cause} />
    </NextIntlClientProvider>,
  );

describe("requirement gate texts in the interface language (night test R2-04, 08.11.26)", () => {
  const summary = "None of the evaluated proposals meets all confirmed requirements according to these evaluations.";
  const cause = "R1 not met according to 2 of 2 evaluators (model judgement).";

  it("shows the engine's known sentences in German", () => {
    expect(render("de", summary, cause)).toContain(
      "Keiner der bewerteten Vorschläge erfüllt laut diesen Bewertungen alle bestätigten Anforderungen.|R1 laut 2 von 2 Bewertern nicht erfüllt (Einschätzung der Modelle).",
    );
  });

  it("gives the English sentence back unchanged in English, and unknown text as sent", () => {
    expect(render("en", summary, cause)).toContain(`${summary}|${cause}`);
    expect(render("de", "Something new.", "R2 not met: 300–400 CHF/month; 2 of 2 evaluators expect the limit to be missed (model estimates).")).toContain(
      "Something new.|R2 not met: 300–400 CHF/month",
    );
  });

  it("rebuilds a measured requirement's cause in German with a decimal comma (R3-02, 08.11.26)", () => {
    const cause = "R3 not confirmed: estimates 99.9–99.97 % (median 99.9425), limit at least 99.95 %; 1 of 2 evaluators' ranges reach across the limit (model estimates).";
    expect(render("de", "x", cause)).toContain(
      "R3 nicht bestätigt: Schätzungen 99,9–99,97 % (Median 99,9425), Grenze mindestens 99,95 %; bei 1 von 2 Bewertern reicht die Spanne über die Grenze (Modellschätzungen).",
    );
  });
});
