import { buildDecisionReport, getSessionView, reportToMarkdown } from "@consyrion/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { reportDocx, reportPdf } from "@/lib/server/report-documents";

/** Export of the Final Decision Report as Markdown (default), JSON, PDF or Word (#164) – same content in every format. */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const id = (await params).id;
  const view = await getSessionView(await getDb(), actor, id);
  const report = buildDecisionReport(view);
  const format = new URL(request.url).searchParams.get("format");
  if (format === "pdf" || format === "docx") {
    const meta = { title: `Final Decision Report – ${report.project}`, sessionId: id, createdAt: view.session.createdAt };
    const markdown = reportToMarkdown(report);
    const body = format === "pdf" ? await reportPdf(markdown, meta) : await reportDocx(markdown, meta);
    const type = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    return new NextResponse(Buffer.from(body), {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="consyrion-decision-${id}.${format}"` },
    });
  }
  if (format === "json") {
    return NextResponse.json(report, { headers: { "Content-Disposition": `attachment; filename="consyrion-decision-${id}.json"` } });
  }
  return new NextResponse(reportToMarkdown(report), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="consyrion-decision-${id}.md"` },
  });
});
