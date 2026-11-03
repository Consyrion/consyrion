import "server-only";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * PDF and Word versions of the decision report (#164). Both are rendered from the Markdown report, so every format
 * carries exactly the same content (no new model output). Only the small Markdown subset of `reportToMarkdown` is
 * understood: headings, list items, tables, bold labels and paragraphs.
 */

export type ReportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "bullet"; text: string }
  | { kind: "table"; rows: string[][] };

/** Markdown of `reportToMarkdown` → blocks. Markup characters are removed; text stays as written. */
export function reportBlocks(markdown: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const plain = (s: string) =>
    s
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(^|\s)_(.+?)_(?=\s|$|[.,:;])/g, "$1$2")
      .trim();
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: plain(heading[2]!) });
    } else if (trimmed.startsWith("|")) {
      const cells = trimmed
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => plain(c));
      if (cells.every((c) => /^-+$/.test(c))) continue;
      const last = blocks.at(-1);
      if (last?.kind === "table") last.rows.push(cells);
      else blocks.push({ kind: "table", rows: [cells] });
    } else if (trimmed.startsWith("- ")) {
      blocks.push({ kind: "bullet", text: plain(trimmed.slice(2)) });
    } else {
      blocks.push({ kind: "paragraph", text: plain(trimmed), bold: /^\*\*.+\*\*$/.test(trimmed) || /^\*\*[^*]+:\*\*/.test(trimmed) });
    }
  }
  return blocks;
}

/**
 * The PDF standard fonts cover Windows-1252 (German umlauts, €, dashes, quotes). Other characters are replaced by a
 * readable ASCII form instead of breaking the export.
 */
const REPLACEMENTS: Record<string, string> = {
  Σ: "Sum ",
  "≥": ">=",
  "≤": "<=",
  "→": "->",
  "←": "<-",
  "≈": "~",
  "≠": "!=",
  "✓": "OK",
  "✗": "x",
  "×": "x",
  "·": "·",
};
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfSafe(text: string): string {
  return [...text.normalize("NFC")]
    .map((ch) => {
      if (REPLACEMENTS[ch] !== undefined) return REPLACEMENTS[ch];
      const code = ch.codePointAt(0)!;
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) return ch;
      if (ch === "\t") return " ";
      return "?";
    })
    .join("");
}

const PAGE = { width: 595.28, height: 841.89, margin: 56 };
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.35, 0.4, 0.5);
const BRAND = rgb(0.01, 0.41, 0.63);

/** Print-friendly PDF (light, A4) with title, date and session id on the first page and page numbers. */
export async function reportPdf(markdown: string, meta: { title: string; sessionId: string; createdAt: Date }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(meta.title));
  pdf.setProducer("CONSYRION AI");
  pdf.setCreator("CONSYRION AI");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - 2 * PAGE.margin;
  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;

  const ensure = (needed: number) => {
    if (y - needed >= PAGE.margin + 20) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
  };
  const wrap = (text: string, font: PDFFont, size: number, max: number) => {
    const lines: string[] = [];
    for (const raw of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of raw.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= max) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        // A single word longer than the line (ids, URLs) is cut into pieces.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > max) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > max) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    const leading = size * 1.35;
    for (const line of wrap(text, font, size, width - indent)) {
      ensure(leading);
      page.drawText(line, { x: PAGE.margin + indent, y: y - size, size, font, color: opts.color ?? INK });
      y -= leading;
    }
    y -= opts.gap ?? 4;
  };

  write("CONSYRION AI", { font: bold, size: 9, color: BRAND, gap: 2 });
  write(`Session ${meta.sessionId} · ${meta.createdAt.toISOString().slice(0, 10)}`, { size: 8, color: MUTED, gap: 10 });

  for (const block of reportBlocks(markdown)) {
    if (block.kind === "heading") {
      const size = block.level === 1 ? 18 : block.level === 2 ? 13 : 11;
      y -= block.level === 1 ? 0 : 6;
      ensure(size * 3);
      write(block.text, { font: bold, size, color: block.level === 1 ? INK : BRAND, gap: 4 });
    } else if (block.kind === "paragraph") {
      write(block.text, { font: block.bold ? bold : regular });
    } else if (block.kind === "bullet") {
      ensure(14);
      page.drawText("•", { x: PAGE.margin + 2, y: y - 10, size: 10, font: regular, color: MUTED });
      write(block.text, { indent: 12, gap: 2 });
    } else {
      // Tables (the scorecard): one line per row, cells separated, header bold.
      block.rows.forEach((row, index) => write(row.join("  |  "), { font: index === 0 ? bold : regular, size: 9, gap: 1 }));
      y -= 6;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) =>
    p.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 30, y: PAGE.margin / 2, size: 8, font: regular, color: MUTED }),
  );
  return pdf.save();
}

/** Word document (DOCX) with real headings, lists and tables, so it can be edited and styled further. */
export async function reportDocx(markdown: string, meta: { title: string; sessionId: string; createdAt: Date }): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: "CONSYRION AI", bold: true, color: "0369A1", size: 18 })] }),
    new Paragraph({
      children: [new TextRun({ text: `Session ${meta.sessionId} · ${meta.createdAt.toISOString().slice(0, 10)}`, color: "5A6680", size: 16 })],
      spacing: { after: 200 },
    }),
  ];
  for (const block of reportBlocks(markdown)) {
    if (block.kind === "heading") {
      const heading = block.level === 1 ? HeadingLevel.TITLE : block.level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
      children.push(new Paragraph({ text: block.text, heading }));
    } else if (block.kind === "paragraph") {
      children.push(new Paragraph({ children: [new TextRun({ text: block.text, bold: block.bold })], spacing: { after: 120 } }));
    } else if (block.kind === "bullet") {
      children.push(new Paragraph({ text: block.text, bullet: { level: 0 } }));
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (row, index) =>
              new TableRow({
                tableHeader: index === 0,
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: cell, bold: index === 0, size: 18 })] })],
                    }),
                ),
              }),
          ),
        }),
      );
    }
  }
  const doc = new Document({ creator: "CONSYRION AI", title: meta.title, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
