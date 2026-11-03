import { describe, expect, it } from "vitest";
import { betterMatch, checkBinding, proposalText, titleMismatch } from "../src/binding";

const csv = {
  label: "B",
  title: "CSV export first",
  text: proposalText({
    title: "CSV export first",
    summary: "Offer a CSV export of all records; no push channel, no service workers.",
    architecture: "Server-side CSV generation with streaming download.",
  }),
};
const push = {
  label: "A",
  title: "Push notifications first",
  text: proposalText({
    title: "Push notifications first",
    summary: "Web push via service workers with permission prompts.",
    architecture: "Push service, subscription storage and delivery monitoring.",
  }),
};

describe("proposal binding (#93)", () => {
  it("recognises which proposal a text is about", () => {
    expect(betterMatch("Push permissions and service workers are complex; delivery monitoring needed", "B", [csv, push])).toBe("A");
    expect(betterMatch("CSV export with streaming download is simple", "B", [csv, push])).toBeNull();
    // Unspecific text is not a mix-up.
    expect(betterMatch("solid and well reasoned", "B", [csv, push])).toBeNull();
  });

  it("rejects a proposal scored under another proposal's title, and reports missing or unknown labels", () => {
    const mixedUp = [
      {
        proposalLabel: "B",
        proposalTitle: "Push notifications first",
        proposalSummary: "Web push via service workers",
        rationales: ["Push permission problems", "Push service costs"],
      },
    ];
    const result = checkBinding(mixedUp, [csv], [csv, push]);
    expect(result.problem).toContain("the title you gave for Proposal B is the title of Proposal A");
    expect(result.rejected).toEqual(["B"]);
    const right = [
      {
        proposalLabel: "b",
        proposalTitle: "CSV export first",
        proposalSummary: "A CSV export of all records",
        rationales: ["Streaming CSV download is cheap"],
      },
    ];
    expect(checkBinding(right, [csv], [csv, push])).toEqual({ problem: null, rejected: [], warnings: [] });
    expect(checkBinding([], [csv], [csv, push]).problem).toContain("Proposal B was not scored");
    expect(checkBinding([{ ...right[0]!, proposalLabel: "Option A" }], [csv], [csv, push]).problem).toContain("is not one of the proposals shown");
  });

  it("tolerates small title variations and a 'Proposal B:' prefix", () => {
    const titles = [csv, push];
    expect(titleMismatch("Proposal B: CSV-Export first!", "B", titles)).toBeNull();
    expect(titleMismatch("CSV Export", "B", titles)).toBeNull();
    expect(titleMismatch("Push notifications", "B", titles)).toBe("A");
    // Identical titles cannot be told apart and are never a mix-up.
    expect(
      titleMismatch("Same title", "B", [
        { label: "A", title: "Same title" },
        { label: "B", title: "Same title" },
      ]),
    ).toBeNull();
  });
});

describe("German, converged proposals (#145)", () => {
  // Revisions after the Consensus Round of a real run: B replaced its architecture with that of A/C, so the texts
  // are nearly the same words. Only the titles still tell them apart.
  const common =
    "Die Buchungen werden in PostgreSQL mit einem Exclusion-Constraint gegen Doppelbuchungen gespeichert, der Betrieb läuft auf zwei Servern mit Warm-Standby und automatischem Failover, die Oberfläche ist eine PWA für Mitarbeiter und Kunden.";
  const proposals = [
    { label: "A", title: "Django-Monolith mit PostgreSQL-Constraint", text: `Django-Monolith mit PostgreSQL-Constraint ${common} Django Admin für das Team.` },
    {
      label: "B",
      title: "Django-PWA mit Exclusion-Constraint und Warm-Standby",
      text: `Django-PWA mit Exclusion-Constraint und Warm-Standby ${common} Celery für Erinnerungen.`,
    },
    { label: "C", title: "Rails-Anwendung mit zwei Servern", text: `Rails-Anwendung mit zwei Servern ${common} Sidekiq für Erinnerungen.` },
    { label: "D", title: "Managed PostgreSQL und Next.js", text: `Managed PostgreSQL und Next.js ${common} Vercel für das Frontend.` },
  ];
  const evaluation = (label: string, title: string) => ({
    proposalLabel: label,
    proposalTitle: title,
    proposalSummary: "Der Vorschlag setzt auf einen Datenbank-Constraint und zwei Server mit automatischem Failover.",
    // Rationales about shared aspects: lexically closer to another proposal than to the named one.
    rationales: [
      "Der Exclusion-Constraint in PostgreSQL verhindert Doppelbuchungen zuverlässig.",
      "Zwei Server mit Warm-Standby erfüllen das Ausfallziel.",
      "Die PWA für Mitarbeiter und Kunden ist schnell gebaut.",
    ],
  });

  it("keeps correctly bound German evaluations even when the texts converged", () => {
    const answer = proposals.map((p) => evaluation(p.label, p.title));
    const result = checkBinding(answer, proposals, proposals);
    expect(result.problem).toBeNull();
    expect(result.rejected).toEqual([]);
  });

  it("still catches a real mix-up (#93 scenario) and rejects only that proposal", () => {
    const answer = [
      evaluation("A", proposals[0]!.title),
      evaluation("B", proposals[2]!.title),
      evaluation("C", proposals[2]!.title),
      evaluation("D", proposals[3]!.title),
    ];
    const result = checkBinding(answer, proposals, proposals);
    expect(result.rejected).toEqual(["B"]);
    expect(result.problem).toContain("Proposal B is the title of Proposal C");
  });
});
