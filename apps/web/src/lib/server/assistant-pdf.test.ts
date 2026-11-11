import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assistantDocx, assistantPdf, documentFileName } = await import("./assistant-pdf");
const { PDFDocument } = await import("pdf-lib");

const markdown = [
  "## Ergebnis",
  "",
  "Alle drei Vorschläge empfehlen **SQLite** – siehe [Entscheidung](https://app.example.test/sessions/ses_1).",
  "",
  "- Backups täglich",
  "- Kosten unter 20 € → ok",
  "",
  `Langer Link: https://app.example.test/${"x".repeat(300)}`,
].join("\n");
const meta = { title: "Kunden-Zusammenfassung: Vereins-Tool", subtitle: "KI-Zusammenfassung · 8. November 2026", note: "Kein Council-Urteil." };

describe("assistant PDF and Word files (#280, #282)", () => {
  it("renders a PDF with the title as metadata, umlauts, € and a long URL without failing", async () => {
    const bytes = await assistantPdf(markdown, meta);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("Kunden-Zusammenfassung: Vereins-Tool");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders a Word file (zip) and builds safe file names", async () => {
    const bytes = await assistantDocx(markdown, meta);
    expect(Buffer.from(bytes.slice(0, 2)).toString()).toBe("PK");
    expect(documentFileName("consyrium-summary", "Größe: Vereins-Tool?", "pdf")).toBe("consyrium-summary-grosse-vereins-tool.pdf");
    expect(documentFileName("consyrium-chat", "???", "docx")).toBe("consyrium-chat-export.docx");
  });
});
