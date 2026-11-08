import { describe, expect, it } from "vitest";
import { buildConfirmedRequirements, type RequirementCandidate } from "../requirements";
import { splitCoverageGaps } from "../requirement-split";
import { decomposeRequirement } from "./requirement-decomposition";

const R1 = "Gesundheitsdaten nur in Deutschland, Verschlüsselung at rest und in transit, revisionssicherer Audit-Trail 10 Jahre.";

describe("requirement decomposition (#216)", () => {
  it("proposes independent parts for an enumeration – the original wording is kept piece by piece", () => {
    expect(decomposeRequirement(R1)).toEqual({
      kind: "split",
      parts: ["Gesundheitsdaten nur in Deutschland.", "Verschlüsselung at rest und in transit.", "revisionssicherer Audit-Trail 10 Jahre."],
    });
    expect(decomposeRequirement("Hosting in the EU, encryption at rest and in transit, and audit logs kept for 2 years")).toEqual({
      kind: "split",
      parts: ["Hosting in the EU", "encryption at rest and in transit", "audit logs kept for 2 years"],
    });
  });

  it("keeps coupled conditions together (offline + synchronisation + no double booking)", () => {
    expect(
      decomposeRequirement("Bei Internetausfall 4 Stunden offline weiterarbeiten und danach ohne Datenverlust synchronisieren, Doppelbuchungen verboten."),
    ).toEqual({ kind: "coupled" });
    expect(decomposeRequirement("Work offline for 4 hours when the connection drops, then sync without data loss, no double bookings")).toEqual({
      kind: "coupled",
    });
  });

  it("asks instead of splitting when a negation, a restriction or a modal verb may cover every item", () => {
    expect(decomposeRequirement("Keine Speicherung von Kreditkartendaten, Passwörtern im Klartext, Gesundheitsdaten im Ausland.")).toEqual({
      kind: "unclear",
      reason: "shared_scope",
    });
    expect(decomposeRequirement("The system must stay in the EU, encrypt all data at rest, log every access.")).toEqual({
      kind: "unclear",
      reason: "shared_scope",
    });
    expect(decomposeRequirement("Data must stay in the EU, be encrypted at rest, be logged.")).toEqual({ kind: "unclear", reason: "shared_scope" });
    expect(decomposeRequirement("Daten in DE, CH, AT.")).toEqual({ kind: "unclear", reason: "shared_scope" });
    // Live check 08.11.26: the verb belongs only to the first item – splitting gave "ein zentrales Monitoring und …".
    expect(decomposeRequirement("Das System braucht tägliche Backups, ein zentrales Monitoring und ein dokumentiertes Rollback-Konzept.")).toEqual({
      kind: "unclear",
      reason: "shared_scope",
    });
    expect(decomposeRequirement("The platform supports SSO, audit logs and data export.")).toEqual({ kind: "unclear", reason: "shared_scope" });
    expect(decomposeRequirement("Hosting bei Hetzner, AWS oder Azure in Frankfurt.")).toEqual({ kind: "unclear", reason: "alternatives" });
    expect(decomposeRequirement("Payment by invoice, credit card or bank transfer")).toEqual({ kind: "unclear", reason: "alternatives" });
  });

  it("keeps every number, unit and negation in a part and repeats a topic prefix", () => {
    const result = decomposeRequirement("Datenschutz: Daten nur in der EU, Löschung innerhalb von 30 Tagen, kein Tracking ohne Einwilligung.");
    expect(result).toEqual({
      kind: "split",
      parts: ["Datenschutz: Daten nur in der EU.", "Datenschutz: Löschung innerhalb von 30 Tagen.", "Datenschutz: kein Tracking ohne Einwilligung."],
    });
    if (result?.kind === "split")
      expect(splitCoverageGaps("Daten nur in der EU, Löschung innerhalb von 30 Tagen, kein Tracking ohne Einwilligung.", result.parts)).toEqual([]);
    expect(splitCoverageGaps(R1, ["Gesundheitsdaten in Deutschland", "Audit-Trail"])).toEqual(["10", "nur"]);
  });

  it("leaves single statements and numbers with a decimal comma alone", () => {
    expect(decomposeRequirement("Verfügbarkeit mindestens 99,9 % pro Monat.")).toBeNull();
    expect(decomposeRequirement("The p95 response time must be below 300 ms.")).toBeNull();
    expect(decomposeRequirement("Support für Deutsch (Hotline, E-Mail) werktags")).toBeNull();
  });
});

describe("confirming a split (#216)", () => {
  const candidates: RequirementCandidate[] = [{ key: "c1", text: R1, source: { kind: "requirements" }, suspectedInjection: false }];
  const parts = ["Gesundheitsdaten nur in Deutschland.", "Verschlüsselung at rest und in transit.", "revisionssicherer Audit-Trail 10 Jahre."];

  it("takes the original over as its parts, each referencing it – never as 'not taken over'", () => {
    const confirmed = buildConfirmedRequirements(candidates, {
      items: parts.map((text) => ({ text, candidateKey: "c1", splitFrom: R1 })),
      excluded: [],
    });
    expect(confirmed.excluded).toEqual([]);
    expect(confirmed.items.map((i) => [i.id, i.splitFrom])).toEqual([
      ["R1", { text: R1, part: 1, of: 3 }],
      ["R2", { text: R1, part: 2, of: 3 }],
      ["R3", { text: R1, part: 3, of: 3 }],
    ]);
    expect(confirmed.items.every((i) => i.source.kind === "requirements" && i.candidateKey === "c1")).toBe(true);
  });

  it("keeps the original undivided when the user rejects the split", () => {
    const confirmed = buildConfirmedRequirements(candidates, { items: [{ text: R1, candidateKey: "c1" }], excluded: [] });
    expect(confirmed.items).toHaveLength(1);
    expect(confirmed.items[0]!.splitFrom).toBeUndefined();
  });

  it("refuses keeping the original and its parts at the same time", () => {
    expect(() =>
      buildConfirmedRequirements(candidates, {
        items: [{ text: R1, candidateKey: "c1" }, ...parts.map((text) => ({ text, candidateKey: "c1", splitFrom: R1 }))],
        excluded: [],
      }),
    ).toThrow(/Taken over twice/);
  });

  it("references the original of a manual split of the user's own requirement too", () => {
    const own = "Export als PDF, Export als CSV";
    const confirmed = buildConfirmedRequirements(candidates, {
      items: [{ text: R1, candidateKey: "c1" }, ...["Export als PDF", "Export als CSV"].map((text) => ({ text, splitFrom: own }))],
      excluded: [],
    });
    expect(confirmed.items[1]!).toMatchObject({ source: { kind: "user" }, splitFrom: { text: own, part: 1, of: 2 } });
  });
});
