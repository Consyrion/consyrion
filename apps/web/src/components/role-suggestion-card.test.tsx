import { suggestRoleProfiles, suggestRoles } from "@consyrium/core/browser";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "../i18n/all-messages";
import { RoleSuggestionCard } from "./role-suggestion-card";

describe("suggested perspectives with role profiles (#269)", () => {
  const suggestion = suggestRoles({ idea: "Audio stream with login", confirmed: [{ text: "Latency below 30 ms" }] });
  const profiles = [
    { id: "rpr_perf", role: "performance_engineer" as const, visibility: "team" as const },
    { id: "rpr_a", role: "security_expert" as const, visibility: "private" as const },
    { id: "rpr_b", role: "security_expert" as const, visibility: "team" as const },
  ];
  const html = (locale: "de" | "en") =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
        <RoleSuggestionCard
          suggestion={suggestion}
          active={[]}
          onApply={() => undefined}
          profileSuggestions={suggestRoleProfiles(suggestion, profiles)}
          profileNames={{ rpr_perf: "Realtime audio", rpr_a: "Mine", rpr_b: "Team" }}
        />
      </NextIntlClientProvider>,
    );

  it("names the suggested profile per role and asks the user to choose when there are several", () => {
    const de = html("de");
    expect(de).toContain("Vorgeschlagenes Profil: Realtime audio");
    expect(de).toContain("2 eigene Profile für diese Rolle – wähle unten eines");
    expect(de.match(/data-testid="suggested-profile"/g)).toHaveLength(1);
    expect(html("en")).toContain("Suggested profile: Realtime audio");
  });
});
