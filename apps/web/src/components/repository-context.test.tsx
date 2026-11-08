import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { RepositoryContext, type SavedContext } from "./repository-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const saved: SavedContext = {
  id: "doc_1",
  sizeBytes: 63_000,
  repository: "acme/on_xyp",
  branch: "main",
  commitSha: "ad186c0aa11bb22cc33dd44ee55ff66778899aa",
  paths: ["README.md", "docs/latency.md"],
};

const render = (initial: SavedContext | null, canWrite = true, locale: "de" | "en" = "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      <RepositoryContext projectId="prj" canWrite={canWrite} initial={initial} />
    </NextIntlClientProvider>,
  );

describe("repository context: saved state at the top (#242)", () => {
  it("shows the saved repository, commit, files, size and tokens right away, with Change and Remove", () => {
    const html = render(saved);
    expect(html).toContain("Gespeichert: acme/on_xyp @ ad186c0 · 2 Dateien · 63 kB · ≈ 15.750 Tokens pro Modellaufruf");
    expect(html).toContain("Ändern");
    expect(html).toContain("Entfernen");
    // With a saved state the first-time button is not shown.
    expect(html).not.toContain("Dateien aus dem Repository wählen");
  });

  it("without a saved state offers to choose files; readers see the state but no buttons", () => {
    expect(render(null)).toContain("Dateien aus dem Repository wählen");
    const reader = render(saved, false, "en");
    expect(reader).toContain("Saved: acme/on_xyp @ ad186c0 · 2 files");
    expect(reader).not.toContain("Change");
    expect(reader).not.toContain(">Remove<");
  });
});
