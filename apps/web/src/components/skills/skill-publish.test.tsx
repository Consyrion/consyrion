import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { SkillManager, type SkillRow } from "./skill-manager";
import { HubStatusBadge, PublishPanel } from "./skill-publish";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

type Locale = "de" | "en" | "fr" | "es" | "zh";
const render = (node: ReactNode, locale: Locale = "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

const row = (id: string, hub: SkillRow["hub"]): SkillRow => ({
  id,
  name: `Skill ${id}`,
  summary: "Eigener Skill",
  category: "architecture",
  visibility: "private",
  version: 1,
  contentHash: "h",
  editable: true,
  updatedAt: null,
  hub,
});

describe("SkillHub submission UI (#368 PR 4)", () => {
  it("shows the review state and nothing for a skill that was never submitted", () => {
    expect(render(<HubStatusBadge hub={{ publicVersion: null, latestStatus: "draft", hidden: false }} />)).toBe("");
    expect(render(<HubStatusBadge hub={{ publicVersion: null, latestStatus: "pending_review", hidden: false }} />)).toContain("in Prüfung");
    expect(render(<HubStatusBadge hub={{ publicVersion: null, latestStatus: "quarantined", hidden: false }} />)).toContain("gesperrt");
    expect(render(<HubStatusBadge hub={{ publicVersion: 2, latestStatus: "draft", hidden: false }} />)).toContain("öffentlich · v2");
    expect(render(<HubStatusBadge hub={{ publicVersion: 2, latestStatus: "published", hidden: true }} />)).toContain("von der Moderation verborgen");
  });

  it("offers publish for a draft and withdraw for a public skill, only to the author", () => {
    const html = render(
      <SkillManager
        skills={[
          row("a", { publicVersion: null, latestStatus: "draft", hidden: false }),
          row("b", { publicVersion: 1, latestStatus: "published", hidden: false }),
        ]}
        canWrite
        publishEnabled
        limits={{ max: null, own: 2, team: true }}
      />,
    );
    expect(html).toContain("Veröffentlichen…");
    expect(html).toContain("Aus dem SkillHub zurückziehen");
    const readOnly = render(
      <SkillManager
        skills={[row("a", { publicVersion: null, latestStatus: "draft", hidden: false })]}
        canWrite={false}
        publishEnabled
        limits={{ max: null, own: 1, team: true }}
      />,
    );
    expect(readOnly).not.toContain("Veröffentlichen…");
    // behind the flag SKILLHUB_PUBLISH: off → no publish button (withdraw stays)
    const off = render(
      <SkillManager
        skills={[
          row("a", { publicVersion: null, latestStatus: "draft", hidden: false }),
          row("b", { publicVersion: 1, latestStatus: "published", hidden: false }),
        ]}
        canWrite
        limits={{ max: null, own: 2, team: true }}
      />,
    );
    expect(off).not.toContain("Veröffentlichen…");
    expect(off).toContain("Aus dem SkillHub zurückziehen");
  });

  it("renders the panel in every language without missing keys", () => {
    for (const locale of ["en", "de", "fr", "es", "zh"] as const) {
      const html = render(<PublishPanel skill={{ id: "a", name: "Hosting review" }} onClose={() => undefined} onDone={() => undefined} />, locale);
      expect(html).not.toContain("skills.hub.");
      expect(html).toMatch(/SkillHub/);
    }
  });
});
