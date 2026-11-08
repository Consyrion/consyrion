import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/all-messages";
import type { View } from "./helpers";
import { WhyPerspectives } from "./why-perspectives";

const selection = {
  version: 1,
  models: 2,
  suggested: [
    { role: "performance_engineer", matched: ["latency", "audio"], requirements: ["R1"], always: false, profileId: "rpr_1" },
    { role: "security_expert", matched: [], requirements: [], always: true, profileId: null },
    { role: "independent_critical_thinker", matched: [], requirements: [], always: true, profileId: null },
  ],
  notSuggested: ["frontend_engineer", "database_architect"],
  roles: [
    { role: "performance_engineer", origin: "suggestion", profileId: "rpr_1" },
    { role: "security_expert", origin: "suggestion", profileId: null },
    { role: "cost_analyst", origin: "own", profileId: null },
    { role: "software_architect", origin: "coverage", profileId: null },
    { role: "backend_engineer", origin: "default", profileId: null },
  ],
};

const render = (session: Record<string, unknown>) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="UTC">
      <WhyPerspectives view={{ session } as unknown as View} />
    </NextIntlClientProvider>,
  );

describe("why these perspectives (#269)", () => {
  it("shows origin, reason and frozen profile of every active role, only from the stored snapshot", () => {
    const html = render({
      roleSelection: selection,
      roleProfiles: [{ profileId: "rpr_1", version: 1, contentHash: "h", content: { name: "Realtime audio" } }],
    });
    expect(html).toContain("Warum diese Perspektiven?");
    expect(html).toContain("2 Modelle · 5 Perspektiven");
    expect(html).toContain("Standard des Modus (Start ohne Rollenwahl)");
    expect(html).toContain("Themen im Auftrag: latency, audio · Anforderungen: R1");
    expect(html).toContain("Fachprofil: Realtime audio");
    expect(html).toContain("Immer vorgeschlagen: eine Sicherheits- und Risikoprüfung.");
    expect(html).toContain("selbst gewählt");
    expect(html).toContain("ergänzt (jedes Modell prüft)");
    expect(html).toContain("Nicht vorgeschlagen (kein passendes Thema): Frontend-Entwickler, Datenbank-Architekt");
  });

  it("shows nothing for an older council without the snapshot – no reconstruction", () => {
    expect(render({ roleSelection: null })).toBe("");
  });
});
