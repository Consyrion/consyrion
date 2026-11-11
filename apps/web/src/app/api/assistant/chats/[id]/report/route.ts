import { DomainError } from "@consyrium/core";
import { createFeedback, getAssistantChat } from "@consyrium/db";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { after, NextResponse } from "next/server";
import { isLocale, localeCookie } from "@/i18n/locales";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { REPORT_LIMITS, reportExcerpt } from "@/lib/server/assistant-report";
import { getDb } from "@/lib/server/db";
import { notifyAdminsAboutFeedback } from "@/lib/server/feedback";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/**
 * Report an assistant conversation to the feedback inbox (#486 part 3). Body { explanation, consent, preview? }.
 * preview: true → the exact excerpt that would be sent (no model call, nothing stored). Sending needs consent: true and
 * an explanation; the stored feedback text is the explanation plus that excerpt – only the chat's owner can report it.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request).catch(() => ({}))) as { explanation?: unknown; consent?: unknown; preview?: unknown };
  const db = await getDb();
  const { chat, messages } = await getAssistantChat(db, actor, (await params).id);
  const t = await getTranslations("assistant.export");
  const tr = await getTranslations("assistant.report");
  const excerpt = reportExcerpt(messages, { you: t("you"), assistant: t("assistant"), secondOpinion: tr("secondOpinion") });
  if (!excerpt) throw new DomainError("VALIDATION", "This chat has no messages to report");
  if (body.preview === true) return NextResponse.json({ excerpt });

  rateLimit(`feedback:assistant:${actor.userId}`, 10, 24 * 60 * 60_000);
  if (body.consent !== true) throw new DomainError("VALIDATION", "Confirm that this excerpt may be sent");
  const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
  if (explanation.length < 3) throw new DomainError("VALIDATION", "Describe briefly what was wrong");
  const chosen = localeCookie(await cookies());
  const report = await createFeedback(
    db,
    { kind: "user", actor },
    {
      kind: "bug",
      subject: tr("subject", { title: chat.title.slice(0, 60) }),
      text: `${explanation.slice(0, REPORT_LIMITS.explanation)}\n\n---\n${excerpt}`,
      page: "/assistant",
      locale: isLocale(chosen) ? chosen : null,
      agent: (await headers()).get("user-agent")?.slice(0, 400) ?? null,
      appVersion: process.env.APP_VERSION ?? "dev",
    },
  );
  after(async () => {
    await notifyAdminsAboutFeedback(report);
  });
  return NextResponse.json({ id: report.id }, { status: 201 });
});
