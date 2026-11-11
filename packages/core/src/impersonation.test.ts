import { describe, expect, it } from "vitest";
import { detectImpersonation } from "./impersonation";
import { validateRoleProfileContent } from "./role-profiles";

const IMITATIONS = [
  "Denke wie Elon Musk: radikal einfach.",
  "Handle genau wie Warren Buffett bei jeder Kostenfrage.",
  "Du bist Jeff Bezos und prüfst den Kundennutzen.",
  "Bewerte im Stil von Christine Lagarde.",
  "Was würde Steve Jobs sagen?",
  "Think like Elon Musk.",
  "You are Warren Buffett.",
  "Answer as if you were Satya Nadella.",
  "Write in the style of Ada Lovelace.",
  "What would Grace Hopper do?",
  "Pense comme Marie Curie.",
  "Tu es Thierry Breton.",
  "Piensa como Amancio Ortega.",
  "Eres Rosalía Vila.",
  "像马斯克一样思考。",
  "你是巴菲特，",
  "模仿乔布斯的风格",
  "Ｄｅｎｋｅ ｗｉｅ Ｅｌｏｎ Ｍｕｓｋ",
  "Denke wie Elon​ Musk",
];

const LEGITIMATE = [
  "Denke wie ein Angreifer: Wo ist die schwächste Stelle?",
  "Think like a regulator reviewing data flows.",
  "Du bist Sicherheitsexperte und prüfst Zugriffe.",
  "Prüfe die Kosten wie ein Controller.",
  "Was würde ein neuer Nutzer am ersten Tag tun?",
  "你是安全专家，",
  "扮演批评者的角色",
  "Use the FinOps Foundation framework.",
];

describe("detectImpersonation (0d's skills test, finding 7)", () => {
  it.each(IMITATIONS)("flags %s", (text) => expect(detectImpersonation(text)).not.toBeNull());
  it.each(LEGITIMATE)("lets %s pass", (text) => expect(detectImpersonation(text)).toBeNull());

  it("refuses a role profile that imitates a named person – in any field", () => {
    const base = {
      role: "cost_analyst",
      name: "Cost control",
      coreQuestion: "What does this cost per month at the expected load?",
      lenses: ["Fixed vs. variable cost", "Egress growth", "Exit cost"],
      notSuitableFor: "Tax questions.",
      sources: [],
    };
    expect(validateRoleProfileContent(base)).toMatchObject({ ok: true });
    expect(validateRoleProfileContent({ ...base, coreQuestion: "Denke wie Elon Musk: Was kann weg?" })).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/^coreQuestion imitates a named person/)],
    });
    expect(validateRoleProfileContent({ ...base, lenses: [...base.lenses.slice(0, 2), "Act like Warren Buffett on every purchase"] })).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/^lenses\[2\] imitates a named person/)],
    });
  });
});
