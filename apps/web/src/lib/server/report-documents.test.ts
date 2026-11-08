import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { pdfSafe, reportBlocks, reportDocx, reportPdf } = await import("./report-documents");

// Shape of reportToMarkdown with German content, a table and long text (test data, not a real run).
const markdown = [
  "# Final Decision Report – Vereins-Streaming",
  "",
  "Mode: Consensus · Brief version 1 · Status: awaiting_approval",
  "Vote weights: anthropic/claude-haiku-5-5 8/10, openai/gpt-4o-mini 6/10 (suggested 5)",
  "",
  "## Outcome",
  "A solution is recommended.",
  "",
  "## Evaluation matrix",
  "Formula: total = Σ vote-weighted mean_independent_score(criterion) × weight(criterion) / 100",
  "",
  "| Proposal | Total | Implementable |",
  "|---|---|---|",
  "| B | 5.65 | no |",
  "",
  "**Low confidence:**",
  "- Größere Änderung: Übertragung über 50 Mbit/s → nur ≈ 15 Zuschauer (Ausfallzeit ≥ 0 Minuten)",
  "- " + "Sehr lange Begründung ".repeat(200),
].join("\n");
const meta = { title: "Final Decision Report – Vereins-Streaming", sessionId: "ses_test", createdAt: new Date("2026-10-27T12:00:00Z") };

describe("decision report as PDF and Word (#164)", () => {
  it("reads the Markdown subset of the report into blocks", () => {
    const blocks = reportBlocks(markdown);
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "Final Decision Report – Vereins-Streaming" });
    expect(blocks).toContainEqual({
      kind: "table",
      rows: [
        ["Proposal", "Total", "Implementable"],
        ["B", "5.65", "no"],
      ],
    });
    expect(blocks).toContainEqual({ kind: "paragraph", text: "Low confidence:", bold: true });
    expect(blocks.filter((b) => b.kind === "bullet")).toHaveLength(2);
  });

  it("keeps German umlauts and replaces characters the PDF fonts cannot show", () => {
    expect(pdfSafe("Größe – Übertragung € „ok“")).toBe("Größe – Übertragung € „ok“");
    expect(pdfSafe("Σ x ≥ 0 → ≈")).toBe("Sum  x >= 0 -> ~");
  });

  it("renders a PDF with several pages for a long report", async () => {
    const bytes = await reportPdf(markdown, meta);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe(meta.title);
  });

  it("renders an editable Word document with headings, list and table", async () => {
    const bytes = await reportDocx(markdown, meta);
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Größere Änderung");
    expect(xml).toContain("Σ vote-weighted");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("ses_test");
  });
});

describe("graphical decision summary on page 1 (stage 1 visualisations)", () => {
  // Synthetic report (test data, not a real run): B scores higher but misses a requirement.
  const report = {
    project: "Todo search",
    outcomeText: "A solution is recommended.",
    decisionFormat: { gateVersion: 2, approvable: true, reason: null },
    requirementsConflict: false,
    recommendedSolution: { label: "A", title: "Pure searchTodos" },
    approvableProposals: ["A"],
    evaluationMatrix: {
      weights: { technicalQuality: 30, security: 25, maintainability: 20, operatingCost: 15, implementationSpeed: 10 },
      proposals: [
        { label: "A", total: 8.44, criterionMeans: { technicalQuality: 8.5, security: 8 } },
        { label: "B", total: 9.12, criterionMeans: { technicalQuality: 9.5, security: 9 } },
      ],
    },
    requirementMatrix: {
      requirements: [
        { id: "R1", text: "Runs on Node 22 without dependencies" },
        { id: "R2", text: "Existing tests keep passing" },
      ],
      proposals: [
        {
          proposal: "A",
          cells: [
            { status: "PASS", met: 2, expected: 2 },
            { status: "PASS", met: 2, expected: 2 },
          ],
        },
        {
          proposal: "B",
          cells: [
            { status: "PASS", met: 2, expected: 2 },
            { status: "UNKNOWN", met: 1, expected: 2 },
          ],
        },
      ],
    },
    objections: [{ proposal: "B", severity: "high", status: "accepted" }],
    approvals: [],
  };

  it("draws the summary page in the interface language (#322)", async () => {
    const meta = { title: "Abschlussbericht – Todo search", sessionId: "ses_test", createdAt: new Date("2026-11-05T12:00:00Z") };
    const bytes = await reportPdf(markdown, meta, report as never, { locale: "de" });
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const first = (text as string[])[0]!;
    expect(first).toContain("Entscheidungsübersicht");
    expect(first).toContain("Empfohlen: Vorschlag A");
    expect(first).toContain("Eine Lösung wird empfohlen.");
    expect(first).toContain("nicht freigebbar");
    expect(first).toContain("? unbestätigt 1/2");
    expect(first).toContain("Technische Qualität");
    expect(first).toContain("Vorschlag B: 1 hoch");
    expect(first).not.toContain("Decision summary");
  });

  it("puts the shared verdict status on top: screen wording, workflow and approval status apart (#268, #477)", async () => {
    const { reportStatus } = await import("./report-status");
    const view = {
      session: { status: "awaiting_approval" },
      decision: { outcome: "needs_verification", matrix: {} },
      decisionStatus: { readable: true, approvable: false, gateVersion: 2, approvableProposalIds: [] },
    };
    const status = reportStatus(view, "de");
    expect(status).toMatchObject({
      title: "Prüfung nötig – nicht freigebbar",
      approvable: false,
      line: "Wartet auf deine Prüfung · Kein freigebbarer Vorschlag",
    });
    const blocked = { ...report, approvableProposals: [], decisionFormat: { approvable: false } };
    const bytes = await reportPdf(markdown, meta, blocked as never, { locale: "de", status, level: "brief" });
    const { extractText } = await import("unpdf");
    const first = ((await extractText(new Uint8Array(bytes), { mergePages: false })).text as string[])[0]!;
    // Status line and title come before any score.
    const top = first.indexOf("Wartet auf deine Prüfung · Kein freigebbarer Vorschlag");
    expect(top).toBeGreaterThanOrEqual(0);
    expect(first.indexOf("Prüfung nötig – nicht freigebbar")).toBeGreaterThan(top);
    expect(first).not.toContain("Empfohlen: Vorschlag A");
    // An approvable recommendation names the proposal after the screen's title.
    const ok = reportStatus(
      { ...view, decision: { outcome: "recommended", matrix: {} }, decisionStatus: { readable: true, approvable: true, approvableProposalIds: ["p1"] } },
      "de",
    );
    const okText = (
      (await extractText(new Uint8Array(await reportPdf(markdown, meta, report as never, { locale: "de", status: ok, level: "brief" })), { mergePages: false }))
        .text as string[]
    )[0]!;
    expect(okText).toContain("Empfohlene Lösung: Vorschlag A");
    expect(okText).toContain("Wartet auf deine Entscheidung");
  });

  it("brief: requirements before scores, then the key disputes and next steps of the screen, decision in words (#268 part 2)", async () => {
    const { reportStatus } = await import("./report-status");
    const t0 = "2026-11-05T10:00:00Z";
    // A stored council shape (test data, not a real run): B has a blocking, unanswered critical objection.
    const view = {
      session: { status: "changes_requested" },
      participants: [
        { id: "par_c", provider: "anthropic", modelId: "claude-haiku-5-5", status: "active" },
        { id: "par_o", provider: "openai", modelId: "gpt-5-mini", status: "active" },
      ],
      proposals: [
        {
          id: "pro_a",
          label: "A",
          authorParticipantId: "par_c",
          revisions: [{ version: 1, createdAt: t0, content: { title: "Pure searchTodos", assumptions: ["Lists stay below 10k items"] } }],
        },
        { id: "pro_b", label: "B", authorParticipantId: "par_o", revisions: [{ version: 1, createdAt: t0, content: { title: "Index" } }] },
      ],
      messages: [],
      objections: [
        {
          id: "o_block",
          proposalId: "pro_b",
          raisedByParticipantId: "par_c",
          category: "security",
          severity: "critical",
          claim: "Tenant data can leak",
          evidence: "Shared cache",
          response: null,
          undefendedReason: "provider error (timeout)",
          status: "unresolved",
          blocking: true,
          createdAt: "2026-11-05T10:06:00Z",
        },
      ],
      consensus: null,
      requirementList: { items: [{ id: "req_1", text: "Runs on Node 22 without dependencies" }] },
      decision: {
        outcome: "recommended",
        recommendedProposalId: "pro_a",
        matrix: {
          proposals: [
            { proposalId: "pro_a", total: 9.12 },
            { proposalId: "pro_b", total: 6.1 },
          ],
        },
      },
      decisionStatus: { readable: true, approvable: true, gateVersion: 2, approvableProposalIds: ["pro_a"], canApproveRecommendation: true },
      approvals: [{ action: "request_changes", comment: "Bitte kleiner", selectedProposalId: null }],
    };
    const status = reportStatus(view, "de");
    expect(status.cruxes!.items[0]!.title).toBe("Streitpunkt 1 · Vorschlag B · kritisch · ungeklärt · blockiert die Freigabe");
    expect(status.cruxes!.items[0]!.lines).toContain("“Tenant data can leak”");
    expect(status.nextSteps!.lines[0]).toContain("Für den empfohlenen Vorschlag A");
    const bytes = await reportPdf(markdown, meta, { ...report, approvals: [{ action: "request_changes", comment: "Bitte kleiner" }] } as never, {
      locale: "de",
      status,
      level: "brief",
    });
    const { extractText } = await import("unpdf");
    const all = ((await extractText(new Uint8Array(bytes), { mergePages: true })).text as string).replace(/\s+/g, " ");
    // Gate before score: the requirement matrix comes first.
    expect(all.indexOf("Harte Anforderungen je Vorschlag")).toBeGreaterThan(0);
    expect(all.indexOf("Harte Anforderungen je Vorschlag")).toBeLessThan(all.indexOf("Gesamtpunktzahl (0–10)"));
    expect(all).toContain("Entscheidende Streitpunkte");
    expect(all).toContain("Streitpunkt 1 · Vorschlag B · kritisch · ungeklärt · blockiert die Freigabe");
    expect(all).toContain("Keine Antwort – provider error (timeout)");
    expect(all).toContain("Nächste Schritte");
    expect(all).toContain("Riskanteste Annahmen");
    // The human decision in words, never the raw action id.
    expect(all).toContain("Änderungen angefordert – Bitte kleiner");
    expect(all).not.toContain("request changes");
    expect(all).not.toContain("Offene Einwände");
  });

  it("keeps a Chinese PDF English until a CJK font is embedded (#268)", async () => {
    const { pdfLocale } = await import("./report-documents");
    expect(pdfLocale("zh")).toBe("en");
    expect(pdfLocale("de")).toBe("de");
  });

  it("prints a favourite mark under the verdict and the measurements as self-declarations (#249 part 2, #268)", async () => {
    const { reportStatus } = await import("./report-status");
    const view = {
      session: { status: "awaiting_approval" },
      proposals: [{ id: "pro_a", label: "A", revisions: [] }],
      requirementList: { items: [{ id: "req_lat", text: "Latenz unter 30 ms" }] },
      decision: {
        id: "dec_1",
        outcome: "needs_verification",
        matrix: {
          requirementGate: {
            proposals: [
              {
                proposalId: "pro_a",
                feasibility: "qualified",
                architectureCandidate: true,
                requirements: [{ requirementId: "req_lat", measurementPending: true }],
              },
            ],
          },
        },
      },
      decisionStatus: { readable: true, approvable: false, gateVersion: 3, approvableProposalIds: [] },
      humanMark: { kind: "favorite", proposalId: "pro_a", comment: "", createdAt: "2026-11-08T12:00:00Z" },
      measurements: [
        {
          id: "m1",
          decisionId: "dec_1",
          proposalId: "pro_a",
          requirementId: "req_lat",
          method: "Ping",
          target: "< 30 ms",
          measured: "41 ms",
          met: false,
          evidence: "Messprotokoll 1",
          recordedBy: "Kim Muster",
          createdAt: "2026-11-08T12:00:00Z",
        },
        {
          id: "m2",
          decisionId: "dec_1",
          proposalId: "pro_a",
          requirementId: "req_lat",
          method: "Ping",
          target: "< 30 ms",
          measured: "25 ms",
          met: true,
          evidence: "Messprotokoll 2",
          recordedBy: "Kim Muster",
          createdAt: "2026-11-08T12:05:00Z",
        },
      ],
    };
    const status = reportStatus(view, "de");
    expect(status.title).toBe("Architektur-Kandidat – Leistungsnachweis offen, nicht freigebbar");
    expect(status.marks).toEqual(["Vorschlag A ist als Favorit markiert – nicht freigegeben; das Urteil muss weiter geprüft werden."]);
    const lines = status.measurements!.lines.join("\n");
    // One measured miss stays decisive, every result is a named self-declaration with its evidence.
    expect(lines).toContain("req_lat Latenz unter 30 ms");
    expect(lines).toContain("Messung: Selbstauskunft von Kim Muster, Beleg: Messprotokoll 1");
    expect(status.measurements!.warn).toBe(true);
    const bytes = await reportPdf(markdown, meta, { ...report, approvableProposals: [], decisionFormat: { approvable: false } } as never, {
      locale: "de",
      status,
      level: "brief",
    });
    const { extractText } = await import("unpdf");
    const all = ((await extractText(new Uint8Array(bytes), { mergePages: true })).text as string).replace(/\s+/g, " ");
    expect(all.indexOf("Vorschlag A ist als Favorit markiert")).toBeGreaterThan(all.indexOf("Architektur-Kandidat – Leistungsnachweis offen"));
    expect(all).toContain("Abnahme durch Messung");
    expect(all).toContain("Messung: Selbstauskunft von Kim Muster, Beleg: Messprotokoll 2");
  });

  it("report level: the course of the council – timeline, participation and tokens, follow-ups, human decisions (#268 part 4)", async () => {
    const { reportStatus } = await import("./report-status");
    const view = {
      session: { status: "changes_requested" },
      participants: [
        { id: "o1", provider: "anthropic", modelId: "claude-opus-5-5", status: "active" },
        { id: "o2", provider: "anthropic", modelId: "claude-opus-5-5", status: "active" },
        { id: "g", provider: "openai", modelId: "gpt-5.4", status: "active" },
      ],
      stages: [
        { phase: "independent_thinking", status: "completed", startedAt: "2026-11-08T10:00:00Z", completedAt: "2026-11-08T10:02:00Z" },
        { phase: "final_verdict", status: "completed", startedAt: "2026-11-08T10:10:00Z", completedAt: "2026-11-08T10:13:00Z" },
      ],
      proposals: [{ id: "pro_a", label: "A", authorParticipantId: "g", revisions: [] }],
      usage: [
        { participantId: "o1", phase: "independent_thinking", outcome: "ok", calls: 1, inputTokens: 1000, outputTokens: 200 },
        { participantId: "g", phase: "final_verdict", outcome: "error", calls: 1, inputTokens: 0, outputTokens: 0 },
      ],
      decision: { id: "dec_1", outcome: "needs_verification", matrix: { followUpRounds: [{ round: 2, kind: "targeted_review", items: 3, applied: true }] } },
      decisionStatus: { readable: true, approvable: false, gateVersion: 3, approvableProposalIds: [] },
      approvals: [{ action: "request_changes", comment: "kleiner", createdAt: "2026-11-08T11:00:00Z" }],
    };
    const status = reportStatus(view, "de");
    const bytes = await reportPdf(markdown, meta, report as never, { locale: "de", status, level: "report" });
    const { extractText } = await import("unpdf");
    const all = ((await extractText(new Uint8Array(bytes), { mergePages: true })).text as string).replace(/\s+/g, " ");
    expect(all).toContain("Ablauf des Councils");
    expect(all).toContain("Independent Thinking: 2026-11-08 10:00 UTC – 2026-11-08 10:02 UTC (2 Min.)");
    expect(all).toContain("Beteiligung je Modell");
    expect(all).toContain("anthropic · claude-opus-5-5 (Instanz 2/2 – eine unabhängige Stimme)");
    expect(all).toContain("anthropic · claude-opus-5-5 (Instanz 1/2 – eine unabhängige Stimme) – Gesamt: 1000 Input- + 200 Output-Tokens");
    expect(all).toContain("Final Verdict: kein Beitrag, 1 fehlgeschlagen");
    expect(all).toContain("Runde 2 (gezielte Nachprüfung): 3 Prüfungen angefordert – abgeschlossen, Ergebnisse übernommen (nachgeholt)");
    expect(all).toContain("Entscheidungsverlauf");
    expect(all).toContain("2026-11-08 11:00 UTC · Änderungen angefordert – kleiner");
    // The brief stays the summary alone.
    const brief = (
      await extractText(new Uint8Array(await reportPdf(markdown, meta, report as never, { locale: "de", status, level: "brief" })), { mergePages: true })
    ).text as string;
    expect(brief).not.toContain("Ablauf des Councils");
  });

  it("adds a summary page with scores, the requirement matrix and 'not approvable' for the blocked proposal", async () => {
    const meta = { title: "Final Decision Report – Todo search", sessionId: "ses_test", createdAt: new Date("2026-11-05T12:00:00Z") };
    const plain = await PDFDocument.load(await reportPdf(markdown, meta));
    const bytes = await reportPdf(markdown, meta, report as never);
    const withSummary = await PDFDocument.load(bytes);
    expect(withSummary.getPageCount()).toBe(plain.getPageCount() + 1);
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const first = (text as string[])[0]!;
    expect(first).toContain("Decision summary");
    expect(first).toContain("Recommended: Proposal A");
    expect(first).toContain("9.1");
    expect(first).not.toContain("9.12");
    expect(first).toContain("not approvable");
    expect(first).toContain("? unconfirmed 1/2");
    expect(first).toContain("Proposal B: 1 high");
    if (process.env.SUMMARY_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.SUMMARY_PDF_OUT, bytes);
  });

  it("exports three levels from the same snapshot: brief = summary only, full = report + audit appendix (#268)", async () => {
    const meta = { title: "Final Decision Report – Todo search", sessionId: "ses_test", createdAt: new Date("2026-11-05T12:00:00Z") };
    const brief = await PDFDocument.load(await reportPdf(markdown, meta, report as never, { level: "brief" }));
    const full = await reportPdf(markdown, meta, report as never, {
      level: "full",
      audit: {
        checks: [
          {
            requirement: "R1 Runs on Node 22",
            proposal: "A",
            evaluator: "openai · gpt-5-mini",
            status: "PASS",
            allPartsMet: true,
            evidence: "package.json engines >=22",
            estimate: null,
            counted: true,
            invalidReason: null,
          },
          {
            requirement: "R2 Existing tests keep passing",
            proposal: "B",
            evaluator: "anthropic · claude-haiku-5-5",
            status: "UNKNOWN",
            allPartsMet: null,
            evidence: "Test suite not visible",
            estimate: null,
            counted: false,
            invalidReason: "requirement id not in the round",
          },
        ],
        usage: [{ model: "openai · gpt-5-mini", phase: "final_verdict", calls: 2, failed: 1, inputTokens: 1200, outputTokens: 300 }],
        versions: { brief: 1, requirements: 2, gate: 2 },
      },
    });
    const report_ = await PDFDocument.load(await reportPdf(markdown, meta, report as never));
    const fullDoc = await PDFDocument.load(full);
    expect(brief.getPageCount()).toBe(1);
    expect(fullDoc.getPageCount()).toBeGreaterThan(report_.getPageCount());
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(full), { mergePages: true });
    expect(text).toContain("Audit appendix");
    expect(text).toContain("package.json engines >=22");
    expect(text).toContain("did not count: requirement id not in the round");
    expect(text).toContain("Total: 1200 input + 300 output tokens");
  });
});
