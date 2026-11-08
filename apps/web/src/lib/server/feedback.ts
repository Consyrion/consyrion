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
  /** Data URL of the screenshot (checked by the repository), attached to the admin e-mail. */
  screenshot?: string | null;
}

/** Turns a stored screenshot data URL into an e-mail attachment; null when there is none or it is malformed. */
export function screenshotAttachment(dataUrl: string | null | undefined): MailMessage["attachments"][number] | null {
  const match = dataUrl ? /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!match) return null;
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  return { filename: `screenshot.${ext}`, content: Buffer.from(match[3]!, "base64"), contentType: match[1]! };
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
      `Screenshot: ${report.screenshot ? "angehängt" : "–"}`,
      "",
      report.text,
      "",
      `Postfach: ${link}`,
    ].join("\n"),
    attachments: [screenshotAttachment(report.screenshot)].filter((a) => a !== null),
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

/* ---------- Reply to the author ---------- */

type ReplyLocale = "en" | "de" | "fr" | "es" | "zh";

/** Text of the reply e-mail in the language the report was written in (English when unknown). */
const REPLY_MAIL: Record<ReplyLocale, { subject: string; intro: string; original: string; appLink: string; noReply: string }> = {
  en: {
    subject: "Re: {subject}",
    intro: "The CONSYRION AI team has answered your message:",
    original: "Your message",
    appLink: "You can also read the answer in the app under My reports:",
    noReply: "Reply to this e-mail if you have further questions.",
  },
  de: {
    subject: "Re: {subject}",
    intro: "Das Team von CONSYRION AI hat auf deine Nachricht geantwortet:",
    original: "Deine Nachricht",
    appLink: "Die Antwort findest du auch in der App unter Meine Meldungen:",
    noReply: "Antworte einfach auf diese E-Mail, wenn du noch Fragen hast.",
  },
  fr: {
    subject: "Re : {subject}",
    intro: "L'équipe CONSYRION AI a répondu à votre message :",
    original: "Votre message",
    appLink: "Vous trouverez aussi la réponse dans l'application sous Mes signalements :",
    noReply: "Répondez à cet e-mail si vous avez d'autres questions.",
  },
  es: {
    subject: "Re: {subject}",
    intro: "El equipo de CONSYRION AI ha respondido a tu mensaje:",
    original: "Tu mensaje",
    appLink: "También encontrarás la respuesta en la aplicación, en Mis reportes:",
    noReply: "Responde a este correo si tienes más preguntas.",
  },
  zh: {
    subject: "回复：{subject}",
    intro: "CONSYRION AI 团队已回复你的消息：",
    original: "你的消息",
    appLink: "你也可以在应用的“我的反馈”中查看回复：",
    noReply: "如有其他问题，请直接回复此邮件。",
  },
};

export interface FeedbackReplyMail {
  email: string;
  locale: string | null;
  subject: string;
  text: string;
  /** Signed-in author: the mail links to "My reports"; a visitor has no account to look at. */
  hasAccount: boolean;
  reply: string;
}

export function feedbackReplyMail(report: FeedbackReplyMail, options: { from: string; replyTo?: string | null; appUrl: string }): MailMessage {
  const lang = (report.locale ?? "").slice(0, 2).toLowerCase();
  const m = REPLY_MAIL[(lang in REPLY_MAIL ? lang : "en") as ReplyLocale];
  const link = options.appUrl ? `${options.appUrl.replace(/\/$/, "")}/settings/feedback` : "";
  const quoted = report.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return {
    from: options.from,
    to: [report.email],
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject: m.subject
      .replace("{subject}", report.subject)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200),
    text: [m.intro, "", report.reply, "", ...(report.hasAccount && link ? [m.appLink, link, ""] : []), `${m.original}:`, quoted, "", m.noReply].join("\n"),
    attachments: [],
  };
}

/** E-mails an admin's reply to the author; "sent", "skipped" (no SMTP) or "failed" – never throws. */
export async function sendFeedbackReplyMail(report: FeedbackReplyMail, deps: NotifyDeps = {}): Promise<"sent" | "skipped" | "failed"> {
  const env = deps.env ?? process.env;
  try {
    const send = deps.sendMail === undefined ? await smtpSenderFromEnv(env) : deps.sendMail;
    if (!send) return "skipped";
    // Answers from the author go to the first admin address, not to the no-reply sender.
    const replyTo = feedbackAdminRecipients(env)[0] ?? null;
    await send(feedbackReplyMail(report, { from: env.MAIL_FROM ?? "CONSYRION AI <no-reply@consyrion.com>", replyTo, appUrl: env.BETTER_AUTH_URL ?? "" }));
    return "sent";
  } catch (error) {
    logger.warn("Feedback reply e-mail failed", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return "failed";
  }
}

/** Client address for the visitor rate limit: the reverse proxy (Caddy) sets X-Forwarded-For, overwriting the client's. */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
}
