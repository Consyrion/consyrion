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
