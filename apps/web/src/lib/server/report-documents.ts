import "server-only";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { reportTranslator, type DecisionReport, type ReportLocale, type ReportT } from "@consyrion/council";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { DecisionAudit } from "./report-audit";

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

const CRITERIA_ORDER = ["technicalQuality", "security", "maintainability", "operatingCost", "implementationSpeed"] as const;
const CRITERIA_SHORT: Record<(typeof CRITERIA_ORDER)[number], string> = {
  technicalQuality: "Technical quality",
  security: "Security",
  maintainability: "Maintainability",
  operatingCost: "Operating cost",
  implementationSpeed: "Speed",
};
const TRACK = rgb(0.9, 0.92, 0.95);
const BAR_MAIN = rgb(0.01, 0.41, 0.63);
const BAR_OTHER = rgb(0.45, 0.66, 0.8);
const BLOCKED = rgb(0.72, 0.74, 0.78);
const HIGHLIGHT = rgb(0.8, 0.93, 0.98);
const STATUS_FILL = { PASS: rgb(0.86, 0.97, 0.9), FAIL: rgb(1, 0.89, 0.89), UNKNOWN: rgb(1, 0.95, 0.8), DISPUTED: rgb(1, 0.95, 0.8) } as const;
const STATUS_INK = { PASS: rgb(0.02, 0.4, 0.22), FAIL: rgb(0.6, 0.08, 0.08), UNKNOWN: rgb(0.5, 0.3, 0.02), DISPUTED: rgb(0.5, 0.3, 0.02) } as const;
const STATUS_WORD = { PASS: "OK met", FAIL: "x not met", UNKNOWN: "? unconfirmed", DISPUTED: "! disputed" } as const; // translated when drawn
const one = (x: number | null | undefined) => (x === null || x === undefined ? "-" : (Math.round(x * 10) / 10).toFixed(1));

/**
 * Page 1 "Decision summary" (owner request 05.11.26, stage 1 of the result visualisations): status, overall score
 * bars, criteria table, requirement × proposal matrix, open objections and the human decision – drawn as vector
 * graphics in a light print design. Proposals the server does not allow to approve are drawn in calm grey with
 * the words "not approvable" (no hatching, design review 05.11.26); scores carry one decimal. The full report follows on the next pages.
 */
function drawSummary(
  pdf: PDFDocument,
  report: DecisionReport,
  fonts: { regular: PDFFont; bold: PDFFont },
  meta: { sessionId: string; createdAt: Date },
  /** The brief has no following pages, so it points to the other PDFs instead (ChatGPT test 06.11.26). */
  standalone = false,
  t: ReportT = reportTranslator("en"),
) {
  const { regular, bold } = fonts;
  const left = PAGE.margin;
  const width = PAGE.width - 2 * PAGE.margin;
  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const ensure = (needed: number) => {
    if (y - needed >= PAGE.margin + 20) return;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
  };
  const text = (t: string, x: number, yy: number, size = 9, font = regular, color = INK) => page.drawText(pdfSafe(t), { x, y: yy, size, font, color });
  const fit = (t: string, max: number, size: number, font = regular) => {
    let out = pdfSafe(t);
    while (out.length > 3 && font.widthOfTextAtSize(out, size) > max) out = `${out.slice(0, -2)}…`.replace("……", "…");
    return out;
  };
  const heading = (t: string) => {
    ensure(40);
    y -= 14;
    text(t, left, y, 12, bold, BRAND);
    y -= 14;
  };
  text("CONSYRION AI", left, y - 9, 9, bold, BRAND);
  text(t("Session {id} · {date}", { id: meta.sessionId, date: meta.createdAt.toISOString().slice(0, 10) }), left + 90, y - 9, 8, regular, MUTED);
  y -= 34;
  text(t("Decision summary"), left, y, 20, bold, INK);
  y -= 16;
  text(fit(report.project, width, 11), left, y, 11, regular, MUTED);
  y -= 18;

  // Status box.
  const approvable = report.decisionFormat?.approvable !== false && !report.requirementsConflict;
  const recommended = approvable ? report.recommendedSolution : null;
  const statusColor = recommended ? rgb(0.86, 0.97, 0.9) : rgb(1, 0.95, 0.8);
  const statusTitle = recommended
    ? `${t("Recommended: Proposal {label}", { label: recommended.label ?? "?" })}${recommended.title ? ` – ${recommended.title}` : ""}`
    : t("No approvable recommendation");
  const reason = pdfSafe(t(report.outcomeText));
  const reasonLines: string[] = [];
  {
    let line = "";
    for (const word of reason.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, 9) > width - 24) {
        reasonLines.push(line);
        line = word;
      } else line = next;
    }
    if (line) reasonLines.push(line);
  }
  const boxH = 34 + Math.min(3, reasonLines.length) * 12;
  page.drawRectangle({
    x: left,
    y: y - boxH,
    width,
    height: boxH,
    color: statusColor,
    borderColor: recommended ? STATUS_INK.PASS : STATUS_INK.UNKNOWN,
    borderWidth: 0.8,
  });
  text(fit(statusTitle, width - 24, 13, bold), left + 12, y - 20, 13, bold, INK);
  reasonLines.slice(0, 3).forEach((l, i) => text(l, left + 12, y - 36 - i * 12, 9, regular, INK));
  y -= boxH + 6;

  const m = report.evaluationMatrix;
  const rows = [...(m?.proposals ?? [])].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  // Reports from before this field (or partial ones) mark nothing as blocked rather than everything.
  const approvableSet = new Set(report.approvableProposals ?? rows.map((r) => r.label));
  if (rows.length) {
    heading(t("Overall score (0–10)"));
    const labelW = 70;
    const valueW = 30;
    const trackW = width - labelW - valueW - 90;
    for (const p of rows) {
      ensure(20);
      const isBlocked = !approvableSet.has(p.label);
      const isRec = recommended?.label === p.label;
      text(t("Proposal {label}", { label: p.label }), left, y - 9, 9, isRec ? bold : regular);
      page.drawRectangle({ x: left + labelW, y: y - 11, width: trackW, height: 9, color: TRACK });
      const w = (Math.max(0, Math.min(10, p.total ?? 0)) / 10) * trackW;
      page.drawRectangle({ x: left + labelW, y: y - 11, width: w, height: 9, color: isBlocked ? BLOCKED : isRec ? BAR_MAIN : BAR_OTHER });
      text(one(p.total), left + labelW + trackW + 6, y - 9, 9, bold);
      text(
        isBlocked ? t("not approvable") : isRec ? t("recommended") : "",
        left + labelW + trackW + 6 + valueW,
        y - 9,
        8,
        regular,
        isBlocked ? STATUS_INK.UNKNOWN : STATUS_INK.PASS,
      );
      y -= 17;
    }

    heading(t("Scores per criterion"));
    const firstCol = 150;
    const colW = Math.min(70, (width - firstCol) / rows.length);
    ensure(16);
    text(t("Criterion (weight)"), left, y - 9, 8, bold, MUTED);
    rows.forEach((p, i) => text(t("Proposal {label}", { label: p.label }), left + firstCol + i * colW, y - 9, 8, bold, MUTED));
    y -= 15;
    const weights = (m?.weights ?? {}) as Record<string, number>;
    for (const c of CRITERIA_ORDER) {
      ensure(16);
      text(`${t(CRITERIA_SHORT[c])}${weights[c] !== undefined ? ` (${weights[c]} %)` : ""}`, left, y - 9, 9);
      // A compact number matrix (as on screen): the highest value among approvable proposals gets a light highlight.
      const values = rows
        .filter((p) => approvableSet.has(p.label))
        .map((p) => (p.criterionMeans as Record<string, number | undefined>)[c])
        .filter((v): v is number => typeof v === "number");
      const best = values.length > 1 ? Math.max(...values) : null;
      rows.forEach((p, i) => {
        const v = (p.criterionMeans as Record<string, number | undefined>)[c];
        const x = left + firstCol + i * colW;
        const isBest = best !== null && v === best && approvableSet.has(p.label);
        page.drawRectangle({ x, y: y - 12, width: colW - 6, height: 13, color: isBest ? HIGHLIGHT : TRACK });
        text(one(v), x + 6, y - 9, 9, isBest ? bold : regular, approvableSet.has(p.label) ? INK : MUTED);
      });
      y -= 15;
    }
    ensure(12);
    text(t("Highlighted: highest value per criterion among approvable proposals; grey = not approvable."), left, y - 7, 7.5, regular, MUTED);
    y -= 12;
  }

  const rm = report.requirementMatrix;
  if (rm && rm.proposals.length) {
    heading(t("Hard requirements by proposal"));
    const firstCol = width - rm.proposals.length * 78;
    ensure(16);
    text(t("Requirement"), left, y - 9, 8, bold, MUTED);
    rm.proposals.forEach((p, i) => text(t("Proposal {label}", { label: p.proposal }), left + firstCol + i * 78, y - 9, 8, bold, MUTED));
    y -= 15;
    rm.requirements.forEach((r, ri) => {
      ensure(20);
      text(fit(`${r.id} ${r.text}`, firstCol - 8, 8.5), left, y - 10, 8.5);
      rm.proposals.forEach((p, i) => {
        const cell = p.cells[ri]!;
        const key = (cell.status in STATUS_FILL ? cell.status : "UNKNOWN") as keyof typeof STATUS_FILL;
        const x = left + firstCol + i * 78;
        page.drawRectangle({ x, y: y - 15, width: 74, height: 15, color: STATUS_FILL[key] });
        text(`${t(STATUS_WORD[key])}${cell.expected ? ` ${cell.met}/${cell.expected}` : ""}`, x + 4, y - 10.5, 7.5, bold, STATUS_INK[key]);
      });
      y -= 18;
    });
  }

  const objections = report.objections ?? [];
  // Same rule as the dashboard fact "critical/high objections open": objections made moot by a revision are not open.
  const open = objections.filter((o) => (o.status === "accepted" || o.status === "unresolved" || o.status === "open") && !o.moot);
  if (objections.length) {
    heading(t("Open objections"));
    const labels = rows.length ? rows.map((r) => r.label) : [...new Set(objections.map((o) => o.proposal))];
    for (const l of labels) {
      ensure(14);
      const mine = open.filter((o) => o.proposal === l);
      const counts = ["critical", "high", "medium", "low"].map((sv) => [sv, mine.filter((o) => o.severity === sv).length] as const).filter(([, n]) => n > 0);
      text(
        `${t("Proposal {label}", { label: l })}: ${counts.length ? counts.map(([sv, n]) => `${n} ${t(sv)}`).join(", ") : t("none open")}`,
        left,
        y - 9,
        9,
        regular,
        counts.some(([sv]) => sv === "critical" || sv === "high") ? STATUS_INK.FAIL : INK,
      );
      y -= 13;
    }
  }

  heading(t("Your decision"));
  const last = (report.approvals ?? []).at(-1);
  ensure(14);
  text(
    fit(
      last ? `${last.action.replaceAll("_", " ")}${last.comment ? ` – ${last.comment}` : ""}` : t("Not decided yet. Nothing is built before a human approves."),
      width,
      9,
    ),
    left,
    y - 9,
    9,
  );
  y -= 20;
  ensure(14);
  text(
    standalone
      ? t("Scores and requirement checks are model judgements with reasons, not a fact check. Full text: “PDF – Report”; every check: “PDF – Full audit”.")
      : t("Scores and requirement checks are model judgements with reasons, not a fact check. Details follow on the next pages."),
    left,
    y - 9,
    7.5,
    regular,
    MUTED,
  );
}

/** Print-friendly PDF (light, A4) with title, date and session id on the first page and page numbers. */
/**
 * Three export levels (#268) from one report snapshot: "brief" = the graphical decision summary only (1–2 pages),
 * "report" = summary + full text report (default), "full" = report + audit appendix (every stored requirement check
 * and the model calls per phase, not shortened).
 */
export type PdfLevel = "brief" | "report" | "full";
export const PDF_LEVELS: readonly PdfLevel[] = ["brief", "report", "full"];

export async function reportPdf(
  markdown: string,
  meta: { title: string; sessionId: string; createdAt: Date },
  /** When given, page 1 is the graphical decision summary; the text report follows. */
  report?: DecisionReport,
  options: { level?: PdfLevel; audit?: DecisionAudit; locale?: ReportLocale } = {},
): Promise<Uint8Array> {
  const level = options.level ?? "report";
  // Fixed wording in the interface language (#322); model output stays as written.
  const t = reportTranslator(options.locale ?? "en");
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(meta.title));
  pdf.setProducer("CONSYRION AI");
  pdf.setCreator("CONSYRION AI");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - 2 * PAGE.margin;
  const summary = Boolean(report?.evaluationMatrix);
  if (summary) drawSummary(pdf, report!, { regular, bold }, meta, level === "brief", t);
  // The brief is the summary alone; without a summary (no verdict yet) it falls back to the text report.
  if (level === "brief" && summary) return finish(pdf, regular);
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
  write(t("Session {id} · {date}", { id: meta.sessionId, date: meta.createdAt.toISOString().slice(0, 10) }), { size: 8, color: MUTED, gap: 10 });

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
  if (level === "full" && options.audit) {
    const a = options.audit;
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
    write(t("Audit appendix"), { font: bold, size: 18, gap: 4 });
    write(
      t(
        "Every stored requirement check (requirement × proposal × evaluator), also checks that did not count, and every model call per phase. Versions: brief v{brief}, requirements v{requirements}, gate v{gate}. Model statements, not a fact check.",
        { brief: a.versions.brief ?? "–", requirements: a.versions.requirements ?? "–", gate: a.versions.gate ?? "–" },
      ),
      { size: 9, color: MUTED, gap: 10 },
    );
    write(t("Requirement checks ({n})", { n: a.checks.length }), { font: bold, size: 13, color: BRAND, gap: 4 });
    if (!a.checks.length) write(t("No requirement checks are stored for this session."), { size: 9 });
    let current = "";
    for (const c of a.checks) {
      if (c.requirement !== current) {
        current = c.requirement;
        y -= 4;
        ensure(40);
        write(c.requirement, { font: bold, size: 10, gap: 2 });
      }
      const flags = [
        c.status === "PASS" && c.allPartsMet === false ? "not every part confirmed" : null,
        c.estimate ? t("estimate {value}", { value: c.estimate }) : null,
        c.counted ? null : t("did not count: {reason}", { reason: c.invalidReason ?? t("invalid") }),
      ].filter(Boolean);
      write(`${t("Proposal {label}", { label: c.proposal })} · ${c.evaluator} · ${c.status}${flags.length ? ` (${flags.join("; ")})` : ""}`, {
        size: 9,
        indent: 10,
        gap: 1,
        font: bold,
        color: c.counted ? INK : MUTED,
      });
      write(c.evidence || "–", { size: 9, indent: 10, gap: 4, color: c.counted ? INK : MUTED });
    }
    y -= 6;
    write(t("Model calls per phase"), { font: bold, size: 13, color: BRAND, gap: 4 });
    // Columns: model, phase, then right-aligned numbers.
    const textCols = [0, 170, 270]; // model, phase (left edges; the last value is the end of the phase column)
    const numberEdges = [310, 355, width - 75, width]; // right edges of calls, failed, input, output
    const row = (cells: string[], font: PDFFont) => {
      ensure(13);
      cells.forEach((cell, i) => {
        const text = pdfSafe(cell);
        let shown = text;
        while (i < 2 && shown.length > 3 && font.widthOfTextAtSize(shown, 8.5) > textCols[i + 1]! - textCols[i]! - 6) shown = `${shown.slice(0, -2)}…`;
        const x = i < 2 ? PAGE.margin + textCols[i]! : PAGE.margin + numberEdges[i - 2]! - font.widthOfTextAtSize(shown, 8.5);
        page.drawText(shown, { x, y: y - 9, size: 8.5, font, color: INK });
      });
      y -= 12;
    };
    row(
      ["Model", "Phase", "Calls", "Failed", "Input tok.", "Output tok."].map((h) => t(h)),
      bold,
    );
    for (const u of a.usage)
      row([u.model, u.phase.replaceAll("_", " "), String(u.calls), String(u.failed), String(u.inputTokens), String(u.outputTokens)], regular);
    y -= 4;
    const total = a.usage.reduce((sum, u) => ({ input: sum.input + u.inputTokens, output: sum.output + u.outputTokens }), { input: 0, output: 0 });
    write(t("Total: {input} input + {output} output tokens", { input: total.input, output: total.output }), { font: bold, size: 9, gap: 4 });
  }
  return finish(pdf, regular);
}

/** Page numbers on every page, then the bytes. */
async function finish(pdf: PDFDocument, regular: PDFFont): Promise<Uint8Array> {
  const pages = pdf.getPages();
  pages.forEach((p, index) =>
    p.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 30, y: PAGE.margin / 2, size: 8, font: regular, color: MUTED }),
  );
  return pdf.save();
}

/** Word document (DOCX) with real headings, lists and tables, so it can be edited and styled further. */
export async function reportDocx(
  markdown: string,
  meta: { title: string; sessionId: string; createdAt: Date },
  locale: ReportLocale = "en",
): Promise<Uint8Array> {
  const t = reportTranslator(locale);
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [new TextRun({ text: "CONSYRION AI", bold: true, color: "0369A1", size: 18 })] }),
    new Paragraph({
      children: [
        new TextRun({ text: t("Session {id} · {date}", { id: meta.sessionId, date: meta.createdAt.toISOString().slice(0, 10) }), color: "5A6680", size: 16 }),
      ],
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
