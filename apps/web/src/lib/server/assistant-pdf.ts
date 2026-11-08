import "server-only";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafe, reportBlocks } from "./report-documents";

/**
 * PDF and Word files of assistant content (#280 chat export, #282 customer summary). Rendered from Markdown with the
 * block parser of the decision report (`reportBlocks`) and its PDF-safe text (`pdfSafe`); the decision report files
 * themselves stay untouched. A header names the kind of document (e.g. "AI summary") so a reader never mistakes model
 * text for a council verdict.
 */

export interface AssistantDocumentMeta {
  title: string;
  /** Line under the title, e.g. "AI summary · 8 Nov 2026" or "Assistant chat · exported 8 Nov 2026". */
  subtitle: string;
  /** Small print at the end, e.g. that the text was written by an AI model from workspace data. */
  note?: string;
  /** Shown when characters outside the PDF fonts (e.g. Chinese) had to be replaced – points to the Word file. */
  lostCharactersNote?: string;
}

/** "[label](https://…)" → "label (https://…)": links stay readable on paper. */
function unlink(markdown: string): string {
  return markdown.replace(/\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\(([^)\s]+)\)/g, (_all, label: string, href: string) =>
    label === href ? href : `${label} (${href})`,
  );
}

const PAGE = { width: 595.28, height: 841.89, margin: 56 };
const TEXT = rgb(0.1, 0.12, 0.18);
const MUTED = rgb(0.35, 0.4, 0.5);
const ACCENT = rgb(0.01, 0.41, 0.63);

export async function assistantPdf(markdown: string, meta: AssistantDocumentMeta): Promise<Uint8Array> {
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
        if (font.widthOfTextAtSize(next, size) <= max) line = next;
        else {
          if (line) lines.push(line);
          // A single word longer than the line (a long URL) is cut into pieces.
          let rest = word;
          while (font.widthOfTextAtSize(rest, size) > max) {
            let cut = rest.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > max) cut--;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          line = rest;
        }
      }
      lines.push(line);
    }
    return lines;
  };
  const write = (text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    const indent = opts.indent ?? 0;
    for (const line of wrap(text, font, size, width - indent)) {
      ensure(size + 4);
      page.drawText(line, { x: PAGE.margin + indent, y: y - size, size, font, color: opts.color ?? TEXT });
      y -= size + 4;
    }
    y -= opts.gap ?? 4;
  };

  write("CONSYRION AI", { size: 9, font: bold, color: ACCENT, gap: 2 });
  write(meta.title, { size: 17, font: bold, gap: 4 });
  write(meta.subtitle, { size: 9, color: MUTED, gap: 14 });

  let previous: string | null = null;
  for (const block of reportBlocks(unlink(markdown))) {
    // A little air after a list before the next paragraph or heading.
    if (previous === "bullet" && block.kind !== "bullet") y -= 6;
    previous = block.kind;
    if (block.kind === "heading") {
      y -= 4;
      ensure(30);
      write(block.text, { size: block.level === 1 ? 14 : block.level === 2 ? 12 : 11, font: bold, gap: 4 });
    } else if (block.kind === "paragraph") write(block.text, { font: block.bold ? bold : regular, gap: 6 });
    else if (block.kind === "bullet") {
      ensure(14);
      page.drawText("•", { x: PAGE.margin + 4, y: y - 10, size: 10, font: regular, color: TEXT });
      write(block.text, { indent: 16, gap: 2 });
    } else {
      for (const [index, row] of block.rows.entries()) write(row.join("  |  "), { size: 9, font: index === 0 ? bold : regular, gap: 2 });
      y -= 6;
    }
  }
  if (meta.note) {
    y -= 8;
    write(meta.note, { size: 8, color: MUTED });
  }
  // The PDF standard fonts cover Western European characters only (ChatGPT review 08.11.26: Chinese became "?").
  if (meta.lostCharactersNote && pdfSafe(markdown).split("?").length > markdown.split("?").length) {
    y -= 4;
    write(meta.lostCharactersNote, { size: 8, color: MUTED });
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) =>
    p.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 30, y: PAGE.margin / 2, size: 8, font: regular, color: MUTED }),
  );
  return pdf.save();
}

/** Word file with real headings, lists and tables, so it can be edited further (e.g. a customer summary). */
export async function assistantDocx(markdown: string, meta: AssistantDocumentMeta): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: "CONSYRION AI", bold: true, color: "0369A1", size: 18 })] }),
    new Paragraph({ text: meta.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: meta.subtitle, color: "5A6680", size: 16 })], spacing: { after: 200 } }),
  ];
  for (const block of reportBlocks(unlink(markdown))) {
    if (block.kind === "heading")
      children.push(
        new Paragraph({
          text: block.text,
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        }),
      );
    else if (block.kind === "paragraph")
      children.push(new Paragraph({ children: [new TextRun({ text: block.text, bold: block.bold })], spacing: { after: 120 } }));
    else if (block.kind === "bullet") children.push(new Paragraph({ text: block.text, bullet: { level: 0 } }));
    else
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map(
            (row, index) =>
              new TableRow({
                tableHeader: index === 0,
                children: row.map(
                  (cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: index === 0, size: 18 })] })] }),
                ),
              }),
          ),
        }),
      );
  }
  if (meta.note)
    children.push(new Paragraph({ children: [new TextRun({ text: meta.note, color: "5A6680", size: 14, italics: true })], spacing: { before: 240 } }));
  const doc = new Document({ creator: "CONSYRION AI", title: meta.title, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** File name: letters, digits and dashes only. */
export function documentFileName(prefix: string, title: string, extension: "md" | "pdf" | "docx"): string {
  const slug = title
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${prefix}-${slug || "export"}.${extension}`;
}
