import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../i18n/all-messages";

// The overview is a server component: getTranslations/getFormatter come from the request config, here German messages.
vi.mock("next-intl/server", async () => {
  const { createTranslator: create, createFormatter } = await import("next-intl");
  const { messagesFor: load } = await import("../i18n/all-messages");
  return {
    getTranslations: async (namespace: string) => create({ locale: "de", messages: load("de") as never, namespace: namespace as never }),
    getFormatter: async () => createFormatter({ locale: "de", timeZone: "Europe/Zurich" }),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/projects/prj_1" }));
vi.mock("server-only", () => ({}));

const { ProjectOverview } = await import("./project-overview");

const project = {
  id: "prj_1",
  status: "active",
  repositoryFullName: "acme/portal",
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-07T12:00:00Z"),
};
const sessions = [
  { id: "ses_2", status: "awaiting_approval", mode: "independent_expert", tokensUsed: 152_984, createdAt: new Date("2026-11-07T21:00:00Z") },
  { id: "ses_1", status: "approved", mode: "adversarial_review", tokensUsed: 400_000, createdAt: new Date("2026-11-06T09:00:00Z") },
];
const overview = {
  selected: "ses_2",
  nodes: [
    {
      id: "p1",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      state: "done" as const,
      details: { roles: [], calls: 4, failedCalls: 0, inputTokens: 1500, outputTokens: 500 },
    },
  ],
  shown: { id: "ses_2", status: "awaiting_approval", outcome: "recommended" },
  lastDecision: { sessionId: "ses_2", status: "awaiting_approval", outcome: "recommended", createdAt: sessions[0]!.createdAt },
  build: { sessionId: "ses_1", status: "completed", pullRequestUrl: "https://github.com/acme/portal/pull/8" },
  tokens: { council: 552_984, build: 60_000, total: 612_984 },
};

async function render(props: Parameters<typeof ProjectOverview>[0]) {
  const element = await ProjectOverview(props);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
      {element}
    </NextIntlClientProvider>,
  );
}

describe("project overview (owner request 08.11.26)", () => {
  it("shows the council graphic and the project facts from stored data", async () => {
    const html = await render({ project, overview, sessions, requirementList: { version: 1, items: [1, 2, 3, 4] }, canRun: true });
    expect(html).toContain("Projektüberblick");
    expect(html).toContain("claude-haiku-5-5");
    expect(html).toContain("Empfohlene Lösung");
    expect(html).toContain('href="/sessions/ses_2"');
    expect(html).toContain("https://github.com/acme/portal/pull/8");
    expect(html).toContain("acme/portal");
    expect(html).toContain("612");
    // The session picker shows the chosen entry (the newest session); the list opens on click.
    expect(html).toContain("Neueste · Independent Expert");
  });

  it("offers to start a council when the project has none", async () => {
    const html = await render({
      project,
      overview: { selected: null, nodes: [], shown: null, lastDecision: null, build: null, tokens: { council: 0, build: 0, total: 0 } },
      sessions: [],
      requirementList: null,
      canRun: true,
    });
    expect(html).toContain("Noch kein Council");
    expect(html).toContain('href="/projects/prj_1/council/new"');
  });
});
