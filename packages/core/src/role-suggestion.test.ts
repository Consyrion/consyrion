import { describe, expect, it } from "vitest";
import { suggestRoles } from "./role-suggestion";

const roles = (r: ReturnType<typeof suggestRoles>) => r.suggested.map((s) => s.role);

describe("role suggestion (#269): deterministic, from brief and confirmed requirements", () => {
  it("leads different projects to different perspectives, always with security and a critic", () => {
    const pricing = suggestRoles({ idea: "Neues Preismodell für unser SaaS-Abo", goal: "Mehr zahlende Kunden ohne Umsatzverlust", confirmed: [{ text: "Preis höchstens 9 € pro Monat" }] });
    const security = suggestRoles({ idea: "Login with passkeys and tenant isolation", confirmed: [{ text: "GDPR compliant storage of personal data" }] });
    const latency = suggestRoles({ idea: "OnJam: Audio-Latenz beim Online-Jammen senken", confirmed: [{ text: "Latenz unter 30 ms zwischen zwei Musikern" }, { text: "Läuft auf dem bestehenden Server" }] });
    const hiring = suggestRoles({ idea: "Should we hire a second developer or use an agency?", goal: "Ship the MVP to customers within 3 months", requirements: "Budget at most 8000 EUR per month" });

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

  it("falls back to the architect when the text names no topic", () => {
    expect(roles(suggestRoles({ idea: "Hello" }))).toEqual(["software_architect", "security_expert", "independent_critical_thinker"]);
  });
});
