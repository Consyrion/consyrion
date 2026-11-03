import { describe, expect, it } from "vitest";
import { dedupeStatements, describeObjection, objectionStatusText } from "./objections";

describe("describeObjection (#169)", () => {
  it("names the objection, its author, the proposal, the reasoning and the decision", () => {
    // Shape of council ses_4df40e35…: Grok quoted the attacked statement in `claim`; the evidence holds the objection.
    const line = describeObjection({
      proposal: "B",
      raisedBy: "xai/grok-4",
      claim: "Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen",
      evidence: "Caching hilft bei VOD,\n nicht bei Live-Transcoding.",
      status: "accepted",
      resolution: "The objection is correct.",
    });
    expect(line).toBe(
      "Objection by xai/grok-4 against Proposal B: Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen" +
        " Reasoning: Caching hilft bei VOD, nicht bei Live-Transcoding. – objection accepted (The objection is correct.)",
    );
    expect(line).not.toMatch(/^accepted/);
  });

  it("marks blocking objections and leaves out empty parts", () => {
    expect(describeObjection({ proposal: "A", raisedBy: "m1", claim: "No auth", status: "unresolved", blocking: true })).toBe(
      "Objection by m1 against Proposal A: No auth – objection unresolved – blocks approval",
    );
    expect(objectionStatusText("refuted")).toBe("objection refuted");
  });
});

describe("dedupeStatements (#173)", () => {
  it("removes exact and normalised duplicates and keeps the first wording", () => {
    expect(
      dedupeStatements([
        "0 Minuten Ausfallzeit ist nicht erreichbar.",
        "0 minuten Ausfallzeit ist nicht erreichbar",
        "  0 Minuten  Ausfallzeit ist nicht erreichbar! ",
        "Keine CDN erlaubt",
        "Keine CDN erlaubt",
        "Ein CDN ist ausgeschlossen",
        "",
      ]),
    ).toEqual(["0 Minuten Ausfallzeit ist nicht erreichbar.", "Keine CDN erlaubt", "Ein CDN ist ausgeschlossen"]);
  });
});
