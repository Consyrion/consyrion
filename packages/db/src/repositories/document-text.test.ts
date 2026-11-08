import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractDocumentText } from "./document-text";

/** Smallest valid PDF with one page per text; xref offsets are computed so pdf.js needs no recovery. */
function pdf(pages: string[]): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: "uint8array" });
}

describe("document text extraction (PDF, DOCX, PPTX)", () => {
  it("reads the text of every PDF page with page markers", async () => {
    const text = await extractDocumentText("konzept.pdf", pdf(["Daten nur in Deutschland", "Budget 400 EUR"]));
    expect(text).toContain("[Page 1]");
    expect(text).toContain("Daten nur in Deutschland");
    expect(text).toContain("[Page 2]");
    expect(text).toContain("Budget 400 EUR");
  });

  it("a PDF without text (e.g. scanned) is refused with a clear message", async () => {
    await expect(extractDocumentText("scan.pdf", pdf([""]))).rejects.toThrow(/no readable text/);
  });

  it("a damaged file is refused, not stored as garbage", async () => {
    await expect(extractDocumentText("broken.pdf", new TextEncoder().encode("not a pdf"))).rejects.toThrow(/could not be read/);
    await expect(extractDocumentText("broken.docx", new TextEncoder().encode("not a zip"))).rejects.toThrow(/could not be read/);
  });

  it("reads DOCX paragraphs, runs, tabs, line breaks and XML entities, ignoring XML indentation", async () => {
    const document = `<?xml version="1.0"?>
<w:document><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:t>Konzept</w:t></w:r>
  </w:p>
  <w:p><w:r><w:t xml:space="preserve">R1: Daten </w:t></w:r><w:r><w:t>&amp; Backups</w:t></w:r><w:r><w:tab/><w:t>DE</w:t><w:br/><w:t>Zeile 2</w:t></w:r></w:p>
</w:body></w:document>`;
    expect(await extractDocumentText("konzept.docx", await zip({ "word/document.xml": document }))).toBe("Konzept\nR1: Daten & Backups\tDE\nZeile 2");
  });

  it("reads PPTX slides in numeric order (slide2 before slide10)", async () => {
    const slide = (text: string) => `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`;
    const bytes = await zip({ "ppt/slides/slide10.xml": slide("Zehn"), "ppt/slides/slide2.xml": slide("Zwei"), "ppt/slides/slide1.xml": slide("Eins") });
    expect(await extractDocumentText("deck.pptx", bytes)).toBe("[Slide 1]\nEins\n\n[Slide 2]\nZwei\n\n[Slide 3]\nZehn");
  });

  it("a DOCX without a document body is refused", async () => {
    await expect(extractDocumentText("empty.docx", await zip({ "other.xml": "<x/>" }))).rejects.toThrow(/no document body/);
  });

  it("stops a zip bomb whose declared size is forged, by counting the bytes really unpacked (#401)", async () => {
    // 60 MB of text compresses to a few kB. The declared sizes (local header + central directory) are then set to
    // 1 kB, so a check on the declared size alone would pass and the whole stream would be inflated.
    const body = `<w:document><w:body><w:p><w:r><w:t>${"A".repeat(60_000_000)}</w:t></w:r></w:p></w:body></w:document>`;
    const z = new JSZip();
    z.file("word/document.xml", body, { createFolders: false });
    const bytes = await z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // One entry: its local header starts the file; the end-of-central-directory record (last 22 bytes) points to
    // its central directory header.
    const centralDirectory = view.getUint32(bytes.length - 22 + 16, true);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(centralDirectory, true)).toBe(0x02014b50);
    view.setUint32(22, 1000, true);
    view.setUint32(centralDirectory + 24, 1000, true);
    expect(bytes.length).toBeLessThan(1_000_000);
    await expect(extractDocumentText("bomb.docx", bytes)).rejects.toThrow(/more than 50 MB/);
  });
});
