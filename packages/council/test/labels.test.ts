import { describe, expect, it } from "vitest";
import { briefNamesLetterOptions, nextProposalLabel, proposalLabels } from "../src/labels";

// QA live test 07.11.26: "Proposal A" recommended option C of a brief that named its options A), B), C).
describe("proposal labels never collide with options the brief names with letters", () => {
  it("numbers the proposals when the brief names lettered options", () => {
    const brief = "Optionen: A) US-Cloud-LLM per API, B) EU-gehostetes Open-Weight-Modell, C) Hybrid. Welche Option?";
    expect(briefNamesLetterOptions(brief)).toBe(true);
    expect(proposalLabels(brief).slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(briefNamesLetterOptions("Should we pick Option A or Option B?")).toBe(true);
    expect(briefNamesLetterOptions("Variante A ist günstiger, Variante C schneller.")).toBe(true);
  });

  it("keeps letters for ordinary briefs – a single letter or 'z. B.' is not an option list", () => {
    expect(briefNamesLetterOptions("Ein CRM für 3 Teams, z. B. mit Postgres. Budget 2.000 CHF.")).toBe(false);
    expect(briefNamesLetterOptions("Plan A) only, nothing else")).toBe(false);
    expect(proposalLabels("Build an invoice tool")[0]).toBe("A");
  });

  it("continues the existing style for a hybrid", () => {
    expect(nextProposalLabel(["A", "B", "C"])).toBe("D");
    expect(nextProposalLabel(["2", "1", "3"])).toBe("4");
  });
});
