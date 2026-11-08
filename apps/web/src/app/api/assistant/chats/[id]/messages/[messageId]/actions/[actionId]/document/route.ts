import { listSessions } from "@consyrion/council";
import { DomainError } from "@consyrion/core";
import { getAssistantChat } from "@consyrion/db";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { assistantDocx, assistantPdf, documentFileName } from "@/lib/server/assistant-pdf";

type Params = { params: Promise<{ id: string; messageId: string; actionId: string }> };

const TYPES = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;

/**
 * A customer summary the assistant drafted (#282) as PDF or Word – `?format=pdf|docx`. Only its chat's owner, and only
 * for a `draft_customer_summary` the user accepted (with their edits): the file holds exactly that text, marked as an
 * AI summary, never new model output.
 */
export const GET = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const { id, messageId, actionId } = await params;
  const formatKey = new URL(request.url).searchParams.get("format");
  if (formatKey !== "pdf" && formatKey !== "docx") throw new DomainError("VALIDATION", "format must be pdf or docx");
  const db = await getDb();
  const { messages } = await getAssistantChat(db, actor, id);
  const action = messages.find((m) => m.id === messageId)?.actions?.find((a) => a.id === actionId);
  if (!action || action.type !== "draft_customer_summary" || action.status !== "executed") throw new DomainError("NOT_FOUND", "Summary not found");
  const text = String(action.params.text ?? "");
  const sessionId = typeof action.params.sessionId === "string" ? action.params.sessionId : null;
  const project = sessionId ? (await listSessions(db, actor)).find((s) => s.id === sessionId)?.projectName : null;
  const t = await getTranslations("assistant.document");
  const format = await getFormatter();
  const meta = {
    title: project ? t("summaryTitleProject", { project }) : t("summaryTitle"),
    subtitle: t("summarySubtitle", { date: format.dateTime(new Date(action.decidedAt ?? Date.now()), { dateStyle: "long" }) }),
    note: t("summaryNote"),
      lostCharactersNote: t("lostCharacters"),
  };
  const bytes = formatKey === "pdf" ? await assistantPdf(text, meta) : await assistantDocx(text, meta);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": TYPES[formatKey],
      "Content-Disposition": `attachment; filename="${documentFileName("consyrion-summary", project ?? "customer", formatKey)}"`,
      "Cache-Control": "no-store",
    },
  });
});
