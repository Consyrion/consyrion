import { suggestRoles } from "@consyrion/core/browser";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import { RoleSuggestionCard } from "../role-suggestion-card";
import { TeamConfig } from "../team-config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }) }));

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="Europe/Zurich">
      {node}
    </NextIntlClientProvider>,
  );

// Brief that suggests other roles than the skill's (database / frontend words).
const suggestion = suggestRoles({ idea: "Neue Datenbank und ein Frontend für das Kundenportal" });
const skill = {
  id: "official:architecture-review",
  version: 1,
  name: "Architecture review",
  mode: "adversarial_review" as const,
  models: 3,
  roles: ["software_architect", "devops_engineer", "security_expert", "cost_analyst", "independent_critical_thinker"] as const,
};

describe("council setup with a skill (#421)", () => {
  it("marks where every active role comes from and offers the project suggestion as an explained alternative", () => {
    const html = render(
      <TeamConfig
        projectId="prj"
        projectName="Portal"
        planName="Pro"
        maxModels={6}
        requirementsConfirmed
        roleSuggestion={suggestion}
        skill={{ ...skill, roles: [...skill.roles] }}
      />,
    );
    // Five skill roles are active, each marked "aus Skill".
    expect(html.match(/>aus Skill</g)).toHaveLength(5);
    expect(html).toContain("Alternative: empfohlene Perspektiven für dieses Projekt");
    expect(html).toContain("Der Skill „Architecture review“ ist aktiv – seine 5 Perspektiven sind unten ausgewählt.");
    expect(html).toMatch(/Durch \d+ Perspektiven ersetzen/);
    expect(html).toContain("„Ersetzen“ tauscht die 5 aktiven Perspektiven");
  });

  it("names the recommended number of models inside the model section – nothing is pre-selected (BYOK)", () => {
    const html = render(
      <TeamConfig projectId="prj" projectName="Portal" planName="Pro" maxModels={6} requirementsConfirmed skill={{ ...skill, roles: [...skill.roles] }} />,
    );
    expect(html).toContain("Der Skill empfiehlt 3 Modelle – wähle sie selbst (deine Keys). 0 von 3 gewählt.");
  });

  it("explains what Apply does without a skill and shows no origin badges", () => {
    const html = render(<RoleSuggestionCard suggestion={suggestion} active={["software_architect"]} onApply={() => undefined} />);
    expect(html).toContain("Übernehmen ersetzt deine aktuelle Auswahl (1 aktiv)");
    expect(html).not.toContain("aus Skill");
    expect(html).not.toContain("ergänzen");
  });
});
