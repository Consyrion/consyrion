import { describe, expect, it } from "vitest";
import { profilesAfterApply, roleSelectionSnapshot, suggestRoleProfiles, suggestRoles, type SuggestableProfile } from "./role-suggestion";

const roles = (r: ReturnType<typeof suggestRoles>) => r.suggested.map((s) => s.role);

describe("role suggestion (#269): deterministic, from brief and confirmed requirements", () => {
  it("leads different projects to different perspectives, always with security and a critic", () => {
    const pricing = suggestRoles({
      idea: "Neues Preismodell für unser SaaS-Abo",
      goal: "Mehr zahlende Kunden ohne Umsatzverlust",
      confirmed: [{ text: "Preis höchstens 9 € pro Monat" }],
    });
    const security = suggestRoles({ idea: "Login with passkeys and tenant isolation", confirmed: [{ text: "GDPR compliant storage of personal data" }] });
    const latency = suggestRoles({
      idea: "OnJam: Audio-Latenz beim Online-Jammen senken",
      confirmed: [{ text: "Latenz unter 30 ms zwischen zwei Musikern" }, { text: "Läuft auf dem bestehenden Server" }],
    });
    const hiring = suggestRoles({
      idea: "Should we hire a second developer or use an agency?",
      goal: "Ship the MVP to customers within 3 months",
      requirements: "Budget at most 8000 EUR per month",
    });

    for (const r of [pricing, security, latency, hiring]) {
      expect(roles(r)).toContain("security_expert");
      expect(roles(r)).toContain("independent_critical_thinker");
    }
    expect(roles(pricing)).toContain("cost_analyst");
    expect(roles(pricing)).toContain("product_strategist");
    expect(roles(latency)).toContain("performance_engineer");
    expect(roles(hiring)).toContain("cost_analyst");
    expect(roles(hiring)).toContain("product_strategist");
    expect(roles(security).filter((r) => !["security_expert", "independent_critical_thinker"].includes(r))).not.toEqual(
      roles(latency).filter((r) => !["security_expert", "independent_critical_thinker"].includes(r)),
    );
  });

  it("names the words and requirements behind each suggestion, and lists the rest as not suggested", () => {
    const r = suggestRoles({ idea: "Audio stream", confirmed: [{ text: "Latency below 30 ms" }] });
    const perf = r.suggested.find((s) => s.role === "performance_engineer")!;
    expect(perf.matched).toEqual(expect.arrayContaining(["latency", "audio", "stream"]));
    expect(perf.requirements).toEqual(["R1"]);
    expect(r.suggested.find((s) => s.role === "security_expert")!.always).toBe(true);
    expect(r.suggested.length + r.notSuggested.length).toBe(12);
  });

  it("matches word starts only and stays within the maximum", () => {
    const r = suggestRoles({ idea: "Build an elastic system" }, { max: 4 });
    expect(roles(r)).not.toContain("frontend_engineer"); // "ui" inside "build"
    expect(roles(r)).not.toContain("performance_engineer"); // "last" inside "elastic"
    const many = suggestRoles({ idea: "api ui database docker test cost market refactor latency architecture" }, { max: 5 });
    expect(many.suggested).toHaveLength(5);
  });

  it('matches a whole-word topic without the next word (live check 08.11.26: "ms inside")', () => {
    const perf = suggestRoles({ idea: "Response within 300 ms inside the office network" }).suggested.find((s) => s.role === "performance_engineer");
    expect(perf?.matched).toEqual(["ms"]);
  });

  it("falls back to the architect when the text names no topic", () => {
    expect(roles(suggestRoles({ idea: "Hello" }))).toEqual(["software_architect", "security_expert", "independent_critical_thinker"]);
  });
});

describe("role profiles in the suggestion (#269 on top of #270)", () => {
  const suggestion = suggestRoles({ idea: "Audio stream with login", confirmed: [{ text: "Latency below 30 ms" }] });
  const profiles: SuggestableProfile[] = [
    { id: "curated:security-review", role: "security_expert", visibility: "curated" },
    { id: "curated:architecture-fit", role: "software_architect", visibility: "curated" },
    { id: "rpr_perf", role: "performance_engineer", visibility: "team" },
    { id: "rpr_sec_own", role: "security_expert", visibility: "private" },
    { id: "rpr_sec_team", role: "security_expert", visibility: "team" },
  ];

  it("suggests one profile per role: the only workspace profile, else the curated one, none when the user must choose", () => {
    const bySuggestion = Object.fromEntries(suggestRoleProfiles(suggestion, profiles).map((p) => [p.role, p]));
    expect(bySuggestion.performance_engineer).toEqual({ role: "performance_engineer", profileId: "rpr_perf", workspaceProfiles: 1 });
    // Two own/team profiles for security: nothing preselected, the curated one is not forced over them.
    expect(bySuggestion.security_expert).toEqual({ role: "security_expert", profileId: null, workspaceProfiles: 2 });
    // No profile at all for the critic.
    expect(bySuggestion.independent_critical_thinker!.profileId).toBeNull();
    const curatedOnly = suggestRoleProfiles(suggestion, profiles.slice(0, 2));
    expect(curatedOnly.find((p) => p.role === "security_expert")!.profileId).toBe("curated:security-review");
  });

  it("applying never overwrites the user's own profile choice and drops profiles of roles that are no longer active", () => {
    const ps = suggestRoleProfiles(suggestion, profiles);
    const roles = suggestion.suggested.map((s) => s.role);
    const applied = profilesAfterApply(roles, ps, { performance_engineer: "rpr_mine", cost_analyst: "curated:cost-control" });
    expect(applied.performance_engineer).toBe("rpr_mine");
    expect(applied.cost_analyst).toBeUndefined();
    expect(applied.security_expert).toBeUndefined();
    // "Add" keeps an own role outside the suggestion together with its profile.
    expect(profilesAfterApply([...roles, "cost_analyst"], ps, { cost_analyst: "curated:cost-control" }).cost_analyst).toBe("curated:cost-control");
  });

  it("freezes what was suggested and where every active role came from; roles stay perspectives, the models count", () => {
    const ps = suggestRoleProfiles(suggestion, profiles);
    const snap = roleSelectionSnapshot({
      suggestion,
      profileSuggestions: ps,
      chosen: ["performance_engineer", "security_expert", "cost_analyst"],
      active: ["performance_engineer", "security_expert", "cost_analyst", "software_architect"],
      skillRoles: ["cost_analyst"],
      profiles: { performance_engineer: "rpr_perf" },
      models: 2,
    });
    expect(snap.roles).toEqual([
      { role: "performance_engineer", origin: "suggestion", profileId: "rpr_perf" },
      { role: "security_expert", origin: "suggestion", profileId: null },
      { role: "cost_analyst", origin: "skill", profileId: null },
      { role: "software_architect", origin: "coverage", profileId: null },
    ]);
    expect(snap.models).toBe(2);
    // A start without a role choice (API, MCP, Telegram): the mode's team is "default", never "chosen by you".
    const api = roleSelectionSnapshot({ suggestion, profileSuggestions: ps, chosen: ["software_architect", "security_expert"], active: ["software_architect", "security_expert"], profiles: {}, models: 3, rolesChosen: false });
    expect(api.roles.map((r) => r.origin)).toEqual(["default", "default"]);
    expect(snap.suggested.find((s) => s.role === "performance_engineer")).toMatchObject({ requirements: ["R1"], profileId: "rpr_perf" });
    expect(snap.suggested.length + snap.notSuggested.length).toBe(12);
  });
});
