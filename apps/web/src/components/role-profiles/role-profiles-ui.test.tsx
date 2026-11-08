import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { RoleProfileDetail, RoleProfileManager, type RoleProfileRow } from "./role-profile-manager";
import { chosenRoleProfileIds, RoleProfilePicker } from "./role-profile-picker";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/settings/role-profiles" }));

const render = (node: ReactNode, locale: "de" | "en" = "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

const rows: RoleProfileRow[] = [
  {
    id: "rpf_1",
    role: "software_architect",
    name: "Audio realtime",
    coreQuestion: "Low latency?",
    visibility: "private",
    version: 2,
    contentHash: "h",
    editable: true,
    updatedAt: null,
  },
  {
    id: "curated:security-review",
    role: "security_expert",
    name: "Security review",
    coreQuestion: "Who can do what?",
    visibility: "curated",
    version: 1,
    contentHash: "c",
    editable: false,
    updatedAt: null,
  },
];

describe("role profiles UI (#270)", () => {
  it("always shows that a perspective is not a model, lists own and curated profiles with their role", () => {
    const html = render(<RoleProfileManager profiles={rows} canWrite canShare={false} />);
    expect(html).toContain('data-testid="perspective-not-model"');
    expect(html).toContain("Drei Rollen auf einem Modell bleiben ein Modell");
    expect(html).toContain("Audio realtime");
    expect(html).toContain("kuratiert");
    expect(html.match(/data-testid="role-profile-row"/g)).toHaveLength(2);
    // A member cannot share: the button is disabled with the reason.
    expect(html).toMatch(/disabled=""[^>]*title="Nur Admins oder Inhaber/);
  });

  it("shows sources with their status and never as a clickable external link", () => {
    const html = render(
      <RoleProfileDetail
        content={{
          role: "security_expert",
          name: "x",
          coreQuestion: "Q?",
          lenses: ["a", "b", "c"],
          notSuitableFor: "Legal advice",
          sources: [
            { title: "Spec", url: "https://example.org/spec", status: "verified", checkedAt: "2026-11-08", note: null },
            { title: "Team note", url: null, status: "own_statement", checkedAt: null, note: null },
          ],
        }}
      />,
      "en",
    );
    expect(html).toContain("Verified");
    expect(html).toContain("Own statement");
    expect(html).toContain("checked 2026-11-08");
    expect(html).not.toContain("<a ");
  });

  it("council setup: offers profiles only for active roles that have one and sends only active choices", () => {
    const html = render(
      <RoleProfilePicker
        roles={["software_architect", "cost_analyst"]}
        profiles={rows}
        value={{ software_architect: "rpf_1" }}
        onChange={() => undefined}
        roleLabel={(r) => r}
      />,
    );
    expect(html).toContain('data-testid="role-profile-picker"');
    // Designed select (no native list): the closed button shows the chosen profile, or "no profile" by default.
    expect(html).toContain("Audio realtime · privat · v2");
    expect(html).not.toContain("<select");
    expect(render(<RoleProfilePicker roles={["software_architect"]} profiles={rows} value={{}} onChange={() => undefined} roleLabel={(r) => r} />)).toContain(
      "Kein Profil",
    );
    expect(html).not.toContain("Security review"); // security_expert is not active
    expect(render(<RoleProfilePicker roles={["cost_analyst"]} profiles={rows} value={{}} onChange={() => undefined} roleLabel={(r) => r} />)).toBe("");
    expect(chosenRoleProfileIds(["cost_analyst"], { software_architect: "rpf_1" })).toEqual([]);
    expect(chosenRoleProfileIds(["software_architect"], { software_architect: "rpf_1" })).toEqual(["rpf_1"]);
  });
});
