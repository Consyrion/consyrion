import { describe, expect, it } from "vitest";
import { blockedExplanation, buildDecisionReport, nextAction, reportLanguageIssues, reportToMarkdown, reportTranslator, type SessionView } from "../src";

/**
 * Shape of the Telegram run ses_a26cbff6… (08.11.26, "E-Mail oder Messenger-Gruppe?"): A and C pass the requirement
 * check, B scores highest but R2 is unconfirmed, and the conflict-of-interest rule stops an automatic recommendation.
 * The German PDF still printed English engine sentences and raw values (ChatGPT review 08.11.26).
 */
const revision = (proposalId: string, title: string) => ({
  id: `${proposalId}-1`,
  proposalId,
  version: 1,
  content: { title, summary: `${title} – Zusammenfassung`, architecture: "E-Mail-Verteiler", risks: [] },
  createdAt: new Date("2026-11-08T01:00:00Z"),
  changes: [],
  keptPosition: false,
  phase: "independent_thinking",
});
const row = (proposalId: string, total: number, eligible: boolean, ineligibleReasons: string[] = []) => ({
  proposalId,
  total,
  implementable: true,
  eligible,
  ineligibleReasons,
  criterionMeans: {},
  criterionSpread: {},
  independentEvaluators: 2,
  bordaPoints: 1,
});
const view = {
  project: { name: "Sollen wir die Vereinsmitglieder per E-Mail oder per Messenger-Gruppe informieren?" },
  session: { id: "ses_a26", mode: "independent_expert", status: "awaiting_approval", tokensUsed: 120_000, tokenBudget: 300_000 },
  brief: { version: 1 },
  participants: [
    { id: "p1", provider: "anthropic", modelId: "claude-haiku-5-5" },
    { id: "p2", provider: "openai", modelId: "gpt-5.4-mini" },
    { id: "p3", provider: "google", modelId: "gemini-3.6-flash" },
  ],
  proposals: [
    { id: "pa", label: "A", authorParticipantId: "p1", revisions: [revision("pa", "E-Mail als Hauptkanal")] },
    { id: "pb", label: "B", authorParticipantId: "p2", revisions: [revision("pb", "E-Mail als Standardkanal")] },
    { id: "pc", label: "C", authorParticipantId: "p3", revisions: [revision("pc", "E-Mail mit Messenger-Ergänzung")] },
  ],
  objections: [
    {
      id: "o1",
      proposalId: "pc",
      claim: "Der WhatsApp-Kanal leitet Daten in die USA.",
      evidence: "Der Vorschlag nennt WhatsApp als Option.",
      status: "accepted",
      createdAt: new Date("2026-11-08T01:10:00Z"),
      raisedByParticipantId: "p1",
      category: "security",
      severity: "high",
      response: "C v2 schließt WhatsApp aus.",
      blocking: false,
      resolutionReason: "Der Einwand ist berechtigt. Addressed by the author in v2. Not independently re-reviewed.",
    },
  ],
  messages: [
    {
      phase: "twelve_minds_council",
      round: 1,
      kind: "critique",
      participantId: "p2",
      role: "security_expert",
      targetProposalId: "pa",
      severity: "medium",
      category: "security",
      body: "Die DSGVO-Tauglichkeit des Messenger-Teils ist zu pauschal.",
      evidence: null,
    },
    {
      phase: "open_council",
      round: 1,
      kind: "question",
      participantId: "p1",
      role: null,
      targetProposalId: "pc",
      severity: null,
      category: null,
      body: "Wie wird das betrieben?",
      evidence: null,
    },
  ],
  scores: [],
  approvals: [],
  stages: [],
  usage: [],
  decision: {
    outcome: "needs_verification",
    recommendedProposalId: null,
    gateVersion: 1,
    matrix: {
      formula: "total = Σ …",
      weights: { security: 25 },
      proposals: [
        row("pb", 8.64, false, ["Not qualified: R2 not confirmed: 1 of 2 evaluators could not confirm it."]),
        row("pa", 8.53, true),
        row("pc", 7.86, true),
      ],
      tiedProposalIds: [],
      majorityVoteWinnerId: null,
      confidence: "low",
      confidenceIssues: [{ kind: "conflict_of_interest", proposalId: "pa", blockedProposalId: "pb" }],
      failedEvaluators: [],
    },
  },
  consensus: { status: "partial", basedOn: [], agreements: ["E-Mail ist der Hauptkanal."], disagreements: ["Messenger-Konzept"], outstandingRisks: [] },
} as unknown as SessionView;

describe("one report language from start to end (ChatGPT review of the Telegram PDFs, 08.11.26)", () => {
  const report = buildDecisionReport(view);
  const de = reportToMarkdown(report, "de");

  it("leaves no English engine sentence or raw value in the German report", () => {
    expect(reportLanguageIssues(de, "de")).toEqual([]);
    expect(de).toContain("Nicht qualifiziert: R2 nicht bestätigt: 1 von 2 Bewertern konnten sie nicht bestätigen.");
    expect(de).toContain("Vorschlag B hat mehr Punkte, wird aber nur durch die Anforderungsprüfungen des Autors von Vorschlag A blockiert");
    expect(de).toContain("Vom Autor in v2 überarbeitet. Die Überarbeitung wurde noch nicht unabhängig nachgeprüft.");
    expect(de).toContain("Kritik · Sicherheitsexperte · Vorschlag A · Sicherheit · Schwere mittel");
    expect(de).toContain("[Sicherheit · Schwere hoch]");
    expect(de).toContain("Status: teilweiser Konsens");
    // Model text stays exactly as written.
    expect(de).toContain("Die DSGVO-Tauglichkeit des Messenger-Teils ist zu pauschal.");
  });

  it("explains why nothing is recommended although A and C pass, and says what to do next", () => {
    const t = reportTranslator("de");
    expect(blockedExplanation(report, "de", t)).toBe(
      "Die Vorschläge A und C haben die Anforderungsprüfung bestanden. Keine automatische Empfehlung: Vorschlag B hat mehr Punkte, wird aber nur durch die Anforderungsprüfungen des Autors von Vorschlag A blockiert – eine Entscheidung zu eigenen Gunsten, daher keine automatische Empfehlung.",
    );
    expect(nextAction(report, t)).toMatch(/^In diesem Council lässt sich nichts freigeben\. Die Vorschläge A und C haben die Anforderungsprüfung bestanden/);
    expect(de).toContain("**Was du jetzt tun musst:**");
    // The engine sentence "could not confirm that a proposal meets every requirement" would contradict A and C.
    expect(de).toContain("Prüfung nötig – es gibt keine automatische Empfehlung, und in diesem Council kann nichts freigegeben oder gebaut werden.");
    expect(de).not.toContain("konnte nicht bestätigen, dass ein Vorschlag alle Anforderungen erfüllt");
    // "Next steps: none" is gone – the recommended proposal named none, so the next action stands there.
    expect(de).not.toMatch(/## Nächste Schritte\n- keine/);
  });

  it("finds the fragments it is meant to catch, and never judges English reports", () => {
    expect(reportLanguageIssues("Status: partial · security_expert · Addressed by the author in v2.", "de")).toEqual([
      "security_expert",
      "Addressed by the author in v2",
      "Status: partial",
    ]);
    expect(reportLanguageIssues(reportToMarkdown(report, "en"), "en")).toEqual([]);
  });

  it("names human decisions in words (Confluence live test 09.11.26: 'approve:')", () => {
    const decided = buildDecisionReport({
      ...view,
      approvals: [{ action: "request_changes", comment: "Bitte AVV ergänzen", createdAt: new Date() }],
    } as unknown as SessionView);
    const text = reportToMarkdown(decided, "de");
    expect(text).toContain("- Änderungen angefordert: Bitte AVV ergänzen");
    expect(text).not.toContain("request_changes");
  });

  it("translates stored exclusion reasons (live test of #410: ask_consyrion context sentences)", () => {
    const withList = buildDecisionReport({
      ...view,
      requirementList: {
        version: 1,
        items: [{ id: "r1", text: "Datenschutz nach DSGVO" }],
        excluded: [{ text: "max. 50 Nutzer", reason: "Context of the question, not a requirement the user listed" }],
      },
    } as unknown as SessionView);
    const text = reportToMarkdown(withList, "de");
    expect(text).toContain("max. 50 Nutzer (Kontext der Frage, keine Anforderung, die der Nutzer aufgeführt hat)");
    expect(reportLanguageIssues(text, "de")).toEqual([]);
  });

  it("writes workflow and approval status apart, as the session header does (#477, #268)", () => {
    expect(report.workflowStatus).toBe("awaiting_review");
    expect(report.approvalStatus).toBe("no_approvable_proposal");
    expect(de).toContain("Status: wartet auf deine Prüfung · kein freigebbarer Vorschlag");
    expect(de).not.toContain("Status: wartet auf Freigabe");
    expect(reportToMarkdown(report, "en")).toContain("Status: awaiting your review · no approvable proposal");
  });

  it("translates the architecture-candidate reason with its ids and offers the favourite step (#511, #268)", async () => {
    const { outcomeLine, nextAction, reportTranslator } = await import("../src");
    const { architectureCandidateText } = await import("../src/decision-format");
    const candidate = {
      ...report,
      outcomeText: architectureCandidateText(["R1", "R3"]),
      approvableProposals: [],
      prototypeProposals: ["B"],
      approvals: [],
      status: "awaiting_approval",
    };
    const line = outcomeLine(candidate as never, "de", reportTranslator("de"));
    expect(line).toContain("Architektur-Kandidat – Leistungsnachweis offen: R1, R3 lässt sich nur durch Messung");
    expect(reportLanguageIssues(line, "de")).toEqual([]);
    expect(nextAction(candidate as never, reportTranslator("de"))).toBe(
      "Vorschlag B ist ein Architektur-Kandidat: Markiere ihn in der App als Favorit, gib einen Prototyp-/Mess-Build frei oder trage das Messergebnis ein – als fertige Lösung wird nichts freigegeben.",
    );
    expect(outcomeLine(candidate as never, "zh", reportTranslator("zh"))).toContain("架构候选");
  });

  it("keeps the same clean result in French and Spanish", () => {
    expect(reportLanguageIssues(reportToMarkdown(report, "fr"), "fr")).toEqual([]);
    expect(reportLanguageIssues(reportToMarkdown(report, "es"), "es")).toEqual([]);
  });

  it("writes the report in Chinese too (#268): fixed wording and engine sentences, model text as written", () => {
    const zh = reportToMarkdown(report, "zh");
    if (process.env.ZH_REPORT_OUT) (globalThis as { console: Console }).console.log(zh);
    expect(reportLanguageIssues(zh, "zh")).toEqual([]);
    expect(zh).toContain("最终决策报告");
    expect(zh).toContain("你现在需要做什么");
    expect(zh).toContain("作者已在 v2 中修订。 该修订尚未经过独立复核。");
    expect(zh).toContain("Die DSGVO-Tauglichkeit des Messenger-Teils ist zu pauschal.");
    for (const english of ["## Outcome", "What you need to do now", "Evaluation matrix", "Not qualified:", "Status: partial"])
      expect(zh).not.toContain(english);
  });

  it("asks a human to choose on a tie the server lets them decide, instead of 'no approvable recommendation'", () => {
    const tie = buildDecisionReport({
      ...view,
      decision: { ...view.decision!, outcome: "tie", matrix: { ...(view.decision!.matrix as object), tiedProposalIds: ["pa", "pc"], confidenceIssues: [] } },
    } as unknown as SessionView);
    const t = reportTranslator("de");
    if (tie.approvableProposals.length) expect(nextAction(tie, t)).toMatch(/^Wähle in der App einen der freigebbaren Vorschläge/);
    else expect(nextAction(tie, t)).toMatch(/^In diesem Council lässt sich nichts freigeben/);
  });
});
