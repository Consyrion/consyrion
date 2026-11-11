import { buildDecisionReport, getSessionView, reportLocale, reportToMarkdown, reportTranslator } from "@consyrium/council";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { isLocale, localeCookie, localeFromAcceptLanguage } from "@/i18n/locales";
import { buildAudit } from "@/lib/server/report-audit";
import { PDF_LEVELS, pdfLocale, type PdfLevel, reportDocx, reportPdf } from "@/lib/server/report-documents";
import { reportStatus } from "@/lib/server/report-status";

/** Export of the Final Decision Report as Markdown (default), JSON, PDF or Word (#164) – same content in every format. */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const id = (await params).id;
  const view = await getSessionView(await getDb(), actor, id);
  const report = buildDecisionReport(view);
  const url = new URL(request.url);
  // Fixed report wording in the interface language (#322): ?lang= first, then the same rule as the UI (cookie, browser).
  const chosen = url.searchParams.get("lang") ?? localeCookie(await cookies());
  const locale = reportLocale(isLocale(chosen) ? chosen : localeFromAcceptLanguage((await headers()).get("accept-language")));
  const format = url.searchParams.get("format");
  // PDF level (#268): brief | report (default) | full – same snapshot, more or less detail.
  const requested = url.searchParams.get("level");
  const level: PdfLevel = PDF_LEVELS.includes(requested as PdfLevel) ? (requested as PdfLevel) : "report";
  if (format === "pdf" || format === "docx") {
    // A Chinese PDF stays English until a CJK font is embedded; Word handles any script (#268).
    const docLocale = format === "pdf" ? pdfLocale(locale) : locale;
    const meta = {
      title: reportTranslator(docLocale)("Final Decision Report – {project}", { project: report.project }),
      sessionId: id,
      createdAt: view.session.createdAt,
    };
    const markdown = reportToMarkdown(report, docLocale);
    const body =
      format === "pdf"
        ? await reportPdf(markdown, meta, report, {
            level,
            locale: docLocale,
            status: reportStatus(view, docLocale),
            verdictId: view.decision?.id ?? null,
            audit: level === "full" ? buildAudit(view) : undefined,
          })
        : await reportDocx(markdown, meta, docLocale);
    const type = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new NextResponse(Buffer.from(body), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="consyrium-decision-${id}${format === "pdf" && level !== "report" ? `-${level}` : ""}.${format}"`,
      },
    });
  }
  if (format === "json") {
    return NextResponse.json(report, { headers: { "Content-Disposition": `attachment; filename="consyrium-decision-${id}.json"` } });
  }
  return new NextResponse(reportToMarkdown(report, locale), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="consyrium-decision-${id}.md"` },
  });
});
