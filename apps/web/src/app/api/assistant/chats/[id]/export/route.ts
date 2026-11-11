import { getAssistantChat } from "@consyrium/db";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { chatMarkdown, exportFileName } from "@/lib/server/assistant-export";
import { assistantDocx, assistantPdf, documentFileName } from "@/lib/server/assistant-pdf";

type Params = { params: Promise<{ id: string }> };

/** Download one chat as Markdown, PDF or Word (#280; `?format=md|pdf|docx`, default md) – only its owner, like reading it. */
export const GET = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const { chat, messages, checks } = await getAssistantChat(await getDb(), actor, (await params).id);
  const t = await getTranslations("assistant.export");
  const ta = await getTranslations("assistant");
  const format = await getFormatter();
  const kind = new URL(request.url).searchParams.get("format");
  const markdown = chatMarkdown(chat, messages, {
    labels: {
      you: t("you"),
      assistant: t("assistant"),
      exported: t("exported"),
      links: t("links"),
      actions: t("actions"),
      // #486: cross-checks go with the answer they checked, in the same words as in the panel.
      checks: {
        heading: t("checks"),
        verdict: { confirmed: ta("checkVerdict.confirmed"), contradicted: ta("checkVerdict.contradicted"), unverifiable: ta("checkVerdict.unverifiable") },
        summary: { confirmed: ta("checkSummary.confirmed"), contradicted: ta("checkSummary.contradicted"), unverified: ta("checkSummary.unverified") },
        sensitive: ta("checkSensitive"),
      },
    },
    checks,
    marks: kind !== "pdf",
    formatDate: (d) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" }),
    appUrl: process.env.BETTER_AUTH_URL ?? new URL(request.url).origin,
  });
  if (kind === "pdf" || kind === "docx") {
    const td = await getTranslations("assistant.document");
    const meta = {
      title: chat.title,
      subtitle: td("chatSubtitle", { date: format.dateTime(new Date(), { dateStyle: "long" }) }),
      note: td("chatNote"),
      lostCharactersNote: td("lostCharacters"),
    };
    // The title is already the document heading; the Markdown's own "# title" line and export line are skipped.
    const body = markdown.split("\n").slice(4).join("\n");
    const bytes = kind === "pdf" ? await assistantPdf(body, meta) : await assistantDocx(body, meta);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${documentFileName("consyrium-chat", chat.title, kind)}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(chat.title)}"`,
      "Cache-Control": "no-store",
    },
  });
});
