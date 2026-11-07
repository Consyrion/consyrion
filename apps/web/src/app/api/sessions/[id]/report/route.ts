import { buildDecisionReport, getSessionView, reportToMarkdown } from "@consyrion/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { buildAudit } from "@/lib/server/report-audit";
import { PDF_LEVELS, type PdfLevel, reportDocx, reportPdf } from "@/lib/server/report-documents";

/** Export of the Final Decision Report as Markdown (default), JSON, PDF or Word (#164) – same content in every format. */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const id = (await params).id;
  const view = await getSessionView(await getDb(), actor, id);
  const report = buildDecisionReport(view);
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  // PDF level (#268): brief | report (default) | full – same snapshot, more or less detail.
  const requested = url.searchParams.get("level");
  const level: PdfLevel = PDF_LEVELS.includes(requested as PdfLevel) ? (requested as PdfLevel) : "report";
  if (format === "pdf" || format === "docx") {
    const meta = { title: `Final Decision Report – ${report.project}`, sessionId: id, createdAt: view.session.createdAt };
    const markdown = reportToMarkdown(report);
    const body =
      format === "pdf"
        ? await reportPdf(markdown, meta, report, { level, audit: level === "full" ? buildAudit(view) : undefined })
        : await reportDocx(markdown, meta);
    const type = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new NextResponse(Buffer.from(body), {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="consyrion-decision-${id}${format === "pdf" && level !== "report" ? `-${level}` : ""}.${format}"` },
    });
  }
  if (format === "json") {
    return NextResponse.json(report, { headers: { "Content-Disposition": `attachment; filename="consyrion-decision-${id}.json"` } });
  }
  return new NextResponse(reportToMarkdown(report), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="consyrion-decision-${id}.md"` },
  });
});
