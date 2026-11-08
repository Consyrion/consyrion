import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { PublicSkillActions } from "./public-skill-actions";

describe("public skill actions (#368 PR 6)", () => {
  it("offers adopt and report in every language without missing keys", () => {
    for (const locale of ["en", "de", "fr", "es", "zh"] as const) {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
          <PublicSkillActions handle="alice" slug="hosting-review" />
        </NextIntlClientProvider>,
      );
      expect(html).not.toContain("skillHub.actions");
      expect(html).toContain("CONSYRION");
    }
  });
});
