import { DomainError } from "@consyrium/core";
import { createFeedback, type FeedbackAuthor } from "@consyrium/db";
import { cookies, headers } from "next/headers";
import { after, NextResponse } from "next/server";
import { isLocale, localeCookie } from "@/i18n/locales";
import { getSessionUser, requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { clientIp, notifyAdminsAboutFeedback } from "@/lib/server/feedback";
import { rateLimit } from "@/lib/server/rate-limit";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Send a bug report, feature wish or contact request (#295). Signed-in users report with their account; visitors
 * leave an e-mail address. Max. 10 per day per user or, for visitors, per IP address. A filled honeypot field
 * ("website", invisible for people) is answered like a success but nothing is stored. The admins get an e-mail in
 * the background; a failed e-mail never fails the report.
 */
export const POST = handle(async (request: Request) => {
  const body = (await readJson(request)) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const requestHeaders = await headers();
  const user = await getSessionUser();

  let author: FeedbackAuthor;
  if (user) {
    const actor = await requireActor();
    rateLimit(`feedback:user:${actor.userId}`, 10, DAY);
    author = { kind: "user", actor };
  } else {
    if (str(body.website)) return NextResponse.json({ ok: true }, { status: 201 });
    rateLimit(`feedback:ip:${clientIp(requestHeaders)}`, 10, DAY);
    const email = str(body.email)?.trim();
    if (!email) throw new DomainError("VALIDATION", "Enter your e-mail address so we can answer", { fieldErrors: { email: ["required"] } });
    author = { kind: "visitor", email };
  }

  const chosen = localeCookie(await cookies());
  const db = await getDb();
  const report = await createFeedback(db, author, {
    kind: str(body.kind) as "bug",
    subject: str(body.subject) ?? "",
    text: str(body.text) ?? "",
    page: str(body.page),
    locale: isLocale(chosen) ? chosen : (str(body.locale)?.slice(0, 10) ?? null),
    agent: requestHeaders.get("user-agent")?.slice(0, 400) ?? null,
    appVersion: process.env.APP_VERSION ?? "dev",
    screenshot: str(body.screenshot) ?? null,
    // #295 stage 3: the project/council of the page only when the user ticked "send this page"; the repository keeps
    // only ids of the user's own workspace.
    context:
      user && body.shareContext === true && body.context && typeof body.context === "object"
        ? { projectId: str((body.context as Record<string, unknown>).projectId), sessionId: str((body.context as Record<string, unknown>).sessionId) }
        : null,
  });
  after(async () => {
    await notifyAdminsAboutFeedback(report);
  });
  return NextResponse.json({ id: report.id }, { status: 201 });
});
