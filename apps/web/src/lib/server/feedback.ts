import "server-only";
import type { FeedbackKind } from "@consyrion/db";
import { smtpSenderFromEnv, type MailMessage } from "./delivery";
import { logger } from "./logger";

/**
 * E-mail to the admins about a new feedback report (#295). Recipients come from ADMIN_EMAILS (comma-separated);
 * without it, or without SMTP_URL, the report is only in the /admin inbox. Sending runs in the background: a failure
 * is logged (without the content) and never fails the report.
 */

export interface FeedbackMailReport {
  id: string;
  kind: FeedbackKind;
  subject: string;
  text: string;
  email: string;
  userId: string | null;
  page: string | null;
  locale: string | null;
  agent: string | null;
  appVersion: string | null;
}

/** Subject prefix as in the brief: "CONSYRION Fehler/Feature/Kontakt: …" (the operator's inbox is German). */
const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Fehler", feature: "Feature", contact: "Kontakt" };

export function feedbackAdminRecipients(env: Record<string, string | undefined> = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
}

export function feedbackMail(report: FeedbackMailReport, options: { to: string[]; from: string; appUrl: string }): MailMessage {
  const link = options.appUrl ? `${options.appUrl.replace(/\/$/, "")}/admin/feedback?id=${encodeURIComponent(report.id)}` : "/admin/feedback";
  return {
    from: options.from,
    to: options.to,
    // The repository already collapses whitespace, so the subject cannot carry header line breaks.
    subject: `CONSYRION ${KIND_LABEL[report.kind]}: ${report.subject}`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: [
      `Art: ${KIND_LABEL[report.kind]}`,
      `Von: ${report.email}${report.userId ? " (angemeldet)" : " (Besucher)"}`,
      `Seite: ${report.page ?? "–"}`,
      `Sprache: ${report.locale ?? "–"}`,
      `Browser: ${report.agent ?? "–"}`,
      `Version: ${report.appVersion ?? "–"}`,
      "",
      report.text,
      "",
      `Postfach: ${link}`,
    ].join("\n"),
    attachments: [],
  };
}

export interface NotifyDeps {
  sendMail?: ((message: MailMessage) => Promise<void>) | null;
  env?: Record<string, string | undefined>;
}

/** Sends the admin e-mail; resolves to "sent", "skipped" (not configured) or "failed" and never throws. */
export async function notifyAdminsAboutFeedback(report: FeedbackMailReport, deps: NotifyDeps = {}): Promise<"sent" | "skipped" | "failed"> {
  const env = deps.env ?? process.env;
  const to = feedbackAdminRecipients(env);
  if (!to.length) return "skipped";
  try {
    const send = deps.sendMail === undefined ? await smtpSenderFromEnv(env) : deps.sendMail;
    if (!send) return "skipped";
    await send(feedbackMail(report, { to, from: env.MAIL_FROM ?? "CONSYRION AI <no-reply@consyrion.com>", appUrl: env.BETTER_AUTH_URL ?? "" }));
    return "sent";
  } catch (error) {
    logger.warn("Feedback e-mail to admins failed", { feedbackId: report.id, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return "failed";
  }
}

/** Client address for the visitor rate limit: the reverse proxy (Caddy) sets X-Forwarded-For, overwriting the client's. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
