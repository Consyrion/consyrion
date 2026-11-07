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
