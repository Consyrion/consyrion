import { getFeedbackForAdmin, replyToFeedback } from "@consyrium/db";
import { after, NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { sendFeedbackReplyMail } from "@/lib/server/feedback";

/**
 * Body { text, email? }: an answer the author sees under "My reports" (platform admin only, #295). With email: true
 * the answer is also e-mailed to the author (visitors have no account, so this is how they get it); the mail is sent
 * after the response and a failure never fails the reply. The response says whether a mail was queued.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = (await readJson(request)) as { text?: unknown; email?: unknown };
  const id = (await params).id;
  const db = await getDb();
  const reply = await replyToFeedback(db, admin, id, typeof body.text === "string" ? body.text : "");
  const email = body.email === true && Boolean(process.env.SMTP_URL?.trim());
  if (email) {
    const { feedback } = await getFeedbackForAdmin(db, admin, id);
    after(async () => {
      await sendFeedbackReplyMail({
        email: feedback.email,
        locale: feedback.locale,
        subject: feedback.subject,
        text: feedback.text,
        hasAccount: Boolean(feedback.userId),
        reply: reply.text,
      });
    });
  }
  return NextResponse.json({ id: reply.id, createdAt: reply.createdAt, emailed: email }, { status: 201 });
});
