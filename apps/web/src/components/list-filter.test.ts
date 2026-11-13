import { describe, expect, it } from "vitest";
import { localizeResponse } from "./session/helpers";
import { matchesQuery } from "./list-filter";

describe("list search (QA 12.11.26)", () => {
  it("matches every term, case- and accent-insensitive, across fields", () => {
    expect(matchesQuery("vereins app", "Testfrage: Datenbank für die Vereins-App")).toBe(true);
    expect(matchesQuery("DATENBANK fur", "Testfrage: Datenbank für die Vereins-App")).toBe(true);
    expect(matchesQuery("onjam", "Testfrage: Datenbank für die Vereins-App", "Independent Expert Mode")).toBe(false);
    expect(matchesQuery("   ", "anything")).toBe(true);
  });
});

describe("author answers with the stored English evidence marker", () => {
  it("shows the marker in the reader's word and keeps the model's text", () => {
    expect(localizeResponse("Granted, will fix.\nEvidence: The architecture names stock footage.", "Beleg")).toBe(
      "Granted, will fix. · Beleg: The architecture names stock footage.",
    );
    expect(localizeResponse("No marker here", "Beleg")).toBe("No marker here");
  });
});
