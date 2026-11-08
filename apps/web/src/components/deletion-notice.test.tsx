import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { DeletionNotice } from "./deletion-notice";

const render = (scope: "project" | "workspace", locale: "en" | "de" = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
      <DeletionNotice scope={scope} />
    </NextIntlClientProvider>,
  );

// #206: a deletion never promises "everything is gone" – backups and external copies are named.
describe("DeletionNotice", () => {
  it("names backups, the audit entry and what stays outside CONSYRION AI for a project", () => {
    const html = render("project");
    expect(html).toContain("30 days");
    expect(html).toContain("GitHub");
    expect(html).toContain("assistant chats are not deleted with the project");
    expect(html).toContain('href="/datenschutz"');
    expect(html).toContain("may still be billed");
  });

  it("names the remaining deletion entry and personal feedback for a workspace", () => {
    const html = render("workspace", "de");
    expect(html).toContain("ohne Inhalte");
    expect(html).toContain("Feedback-Meldungen");
    expect(html).toContain("30 Tagen");
  });
});
