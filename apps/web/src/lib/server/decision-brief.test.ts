import { describe, expect, it } from "vitest";
import { decisionBrief } from "./decision-brief";

// Synthetic session (test data, not a real run): proposal B scores best but is not approvable.
const view = (overrides: Record<string, unknown> = {}) =>
  ({
    project: { name: "Todo dueDate" },
    session: { id: "ses_1", status: "awaiting_approval" },
    requirementList: {
      items: [
        { id: "R1", text: "Keine neuen npm-Abhängigkeiten" },
        { id: "R2", text: "Bestehende Tests bleiben grün" },
      ],
    },
    proposals: [
      { id: "pa", label: "A", revisions: [{ content: { title: "Zeitstempel", summary: "UTC" } }] },
      {
        id: "pb",
        label: "B",
        revisions: [
          {
            content: {
              title: "Kalenderdatum YYYY-MM-DD",
              summary: "dueDate als String speichern.",
              architecture: "Validierung in add(), Feld nur setzen, wenn angegeben.",
              components: ["src/todos.js"],
              risks: [{ risk: "Zeitzonen beim Anzeigen", severity: "low", mitigation: "Nur Datum vergleichen" }],
              assumptions: ["Kein Server-Zeitbezug nötig"],
              recommendations: ["Test für Todo ohne dueDate ergänzen"],
            },
          },
        ],
      },
    ],
    decision: {
      outcome: "needs_verification",
      recommendedProposalId: null,
      matrix: {
        proposals: [
          { proposalId: "pa", total: 6.1 },
          { proposalId: "pb", total: 8.2 },
        ],
        requirementGate: {
          proposals: [
            {
              proposalId: "pb",
              requirements: [
                { requirementId: "R1", status: "PASS" },
                { requirementId: "R2", status: "UNKNOWN" },
              ],
            },
          ],
        },
      },
    },
    decisionStatus: { approvable: false },
    objections: [
      {
        proposalId: "pb",
        status: "open",
        severity: "high",
        category: "functional",
        claim: "Feld mit undefined ändert die Struktur",
        evidence: "",
        blocking: false,
        moot: null,
      },
      { proposalId: "pb", status: "refuted", severity: "high", category: "cost", claim: "widerlegt", evidence: "", blocking: false, moot: null },
    ],
    approvals: [],
    ...overrides,
  }) as never;

describe("decision brief for editor agents (owner request 07.11.26)", () => {
  it("gives the leading proposal in full, the requirement status and the open objections, marked as not approvable", () => {
    const brief = decisionBrief(view());
    expect(brief.chosen).toMatchObject({
      label: "B",
      basis: "leading_not_approvable",
      architecture: expect.stringContaining("Validierung"),
      components: ["src/todos.js"],
    });
    expect(brief.requirements).toEqual([
      { id: "R1", text: "Keine neuen npm-Abhängigkeiten", status: "PASS" },
      { id: "R2", text: "Bestehende Tests bleiben grün", status: "UNKNOWN" },
    ]);
    expect(brief.objections.map((o) => o.claim)).toEqual(["Feld mit undefined ändert die Struktur"]);
    expect(brief.implementationBrief).toContain("LEADING proposal only");
    expect(brief.implementationBrief).toContain("R2 [UNKNOWN] Bestehende Tests bleiben grün");
    expect(brief.implementationBrief).toContain("(low) Zeitzonen beim Anzeigen → Nur Datum vergleichen");
  });

  it("names the proposal the human approved as the decision to implement", () => {
    const brief = decisionBrief(
      view({ session: { id: "ses_1", status: "approved" }, approvals: [{ action: "approve", selectedProposalId: "pa", comment: "ok" }] }),
    );
    expect(brief.chosen).toMatchObject({ label: "A", basis: "approved_by_human" });
    expect(brief.implementationBrief).toContain("APPROVED by a human");
  });

  it("without a verdict there is no decided proposal", () => {
    const brief = decisionBrief(view({ decision: null, session: { id: "ses_1", status: "running" } }));
    expect(brief.chosen).toBeNull();
    expect(brief.implementationBrief).toContain("No verdict yet");
  });
});
