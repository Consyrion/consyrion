import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { SkillHubAdmin } from "./skill-hub-admin";

describe("SkillHub admin (#368 PR 5)", () => {
  it("renders the queue tabs in every language without missing keys", () => {
    for (const locale of ["en", "de", "fr", "es", "zh"] as const) {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
          <SkillHubAdmin providers={[{ id: "anthropic", label: "Anthropic" }]} />
        </NextIntlClientProvider>,
      );
      expect(html).not.toContain("settings.admin.skillHub");
      expect(html).toContain('role="tablist"');
    }
  });
});
