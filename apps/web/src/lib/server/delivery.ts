import "server-only";
import {
  buildDecisionReport,
  getSessionView,
  reportLanguageIssues,
  reportToMarkdown,
  reportTranslator,
  type DecisionReport,
  type ReportLocale,
} from "@consyrion/council";
import { assertCan, DomainError, type Keyring } from "@consyrion/core";
import { deliveryConnectionForUse, listMembers, recordDelivery, setProjectDeliveryDefault, type ActorContext, type Database } from "@consyrion/db";
import { z } from "zod";
import { pdfLocale, reportBlocks, reportPdf } from "./report-documents";
import { reportStatus } from "./report-status";

/**
 * Sending a decision where the user works (#165): e-mail (platform SMTP, PDF attached), Telegram (the workspace's bot,
 * short verdict + PDF) and Confluence (a page in a space). Every send is logged with its outcome; a failure never
 * blocks anything and can be repeated. Secrets stay on the server and never appear in errors or the log.
 */

export const deliverInput = z.discriminatedUnion("target", [
  z.object({ target: z.literal("email"), recipients: z.array(z.string().trim().email()).min(1).max(20), remember: z.boolean().optional() }),
  z.object({ target: z.literal("telegram"), connectionId: z.string().min(1), remember: z.boolean().optional() }),
  z.object({ target: z.literal("confluence"), connectionId: z.string().min(1), remember: z.boolean().optional() }),
]);
export type DeliverInput = z.input<typeof deliverInput>;

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  /** Optional Reply-To header (e.g. the operator's address for answers to a no-reply sender). */
  replyTo?: string;
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface DeliveryDeps {
  fetch?: typeof fetch;
  /** Sends one e-mail; null when no SMTP server is configured. */
  sendMail?: ((message: MailMessage) => Promise<void>) | null;
  appUrl?: string;
  mailFrom?: string;
  /** Language of the fixed wording in summary and PDF (Telegram: the connection's language). */
  locale?: ReportLocale;
}

/**
 * SMTP options from `SMTP_URL` (smtps://user:pass@host:465 or smtp://user:pass@host:587 with STARTTLS), with short
 * timeouts: a blocked port must end as a logged failure within seconds, not after nodemailer's default two minutes.
 * Hetzner blocks outgoing ports 25 and 465 on new servers – use 587 there.
 */
export function smtpOptions(url: string) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "smtps:";
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure,
    auth: parsed.username ? { user: decodeURIComponent(parsed.username), pass: decodeURIComponent(parsed.password) } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

/** E-mail through the platform's SMTP server (`SMTP_URL`, `MAIL_FROM`), or null when it is not configured. */
export async function smtpSenderFromEnv(env: Record<string, string | undefined> = process.env) {
  const url = env.SMTP_URL?.trim();
  if (!url) return null;
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(smtpOptions(url));
  return async (message: MailMessage) => {
    await transport.sendMail(message);
  };
}

/** Removes anything that looks like the secret of a connection from an error before it is shown or stored. */
function safeError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) if (secret) message = message.split(secret).join("•••");
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot•••").slice(0, 300);
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Confluence storage format (XHTML) from the report blocks. */
export function reportStorageHtml(markdown: string) {
  const out: string[] = [];
  let list = false;
  for (const block of reportBlocks(markdown)) {
    if (block.kind !== "bullet" && list) {
      out.push("</ul>");
      list = false;
    }
    if (block.kind === "heading") out.push(`<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`);
    else if (block.kind === "paragraph") out.push(block.bold ? `<p><strong>${escapeHtml(block.text)}</strong></p>` : `<p>${escapeHtml(block.text)}</p>`);
    else if (block.kind === "bullet") {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${escapeHtml(block.text)}</li>`);
    } else {
      const [head, ...rows] = block.rows;
      out.push(
        `<table><tbody><tr>${(head ?? []).map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
    }
  }
  if (list) out.push("</ul>");
  return out.join("");
}

/**
 * Short text for e-mail, Telegram and Confluence. A verdict the server marks as not approvable (#181, stage 1:
 * needs_verification, unknown outcome or format version) never reads as a recommendation.
 */
export function deliverySummary(report: DecisionReport, link: string, locale: ReportLocale = "en") {
  // Telegram live test 08.11.26: the summary was English in a German workspace – fixed wording in the chosen language.
  const t = reportTranslator(locale);
  const approvable = report.decisionFormat?.approvable !== false;
  const r = report.recommendedSolution;
  const confidence = report.evaluationMatrix?.confidence;
  return [
    `CONSYRION AI – ${report.project}`,
    t(report.outcomeText),
    r ? `${approvable ? t("Recommended") : t("Leading proposal (not approvable)")}: ${t("Proposal {label}", { label: r.label })} – ${r.title ?? ""}` : null,
    approvable ? null : t("Not approvable: this verdict cannot be approved or built."),
    confidence && confidence !== "normal" ? t("Confidence: {level}", { level: t(confidence) }) : null,
    link || null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Sends the decision report of a session and logs the outcome. Returns the log entry's status; throws only for
 * invalid input or missing permissions – a failed send is a logged result, not an exception.
 */
export async function deliverDecision(db: Database, actor: ActorContext, keyring: Keyring, sessionId: string, input: DeliverInput, deps: DeliveryDeps = {}) {
  assertCan(actor.role, "decision:run");
  const parsed = deliverInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid delivery", z.flattenError(parsed.error));
  const data = parsed.data;
  const view = await getSessionView(db, actor, sessionId);
  if (!view.decision) throw new DomainError("CONFLICT", "There is no verdict to send yet");
  const report = buildDecisionReport(view);
  const locale = deps.locale ?? "en";
  const markdown = reportToMarkdown(report, locale);
  // Language check before the report leaves the app (ChatGPT review 08.11.26). It reports, it does not block: a
  // late English fragment must not stop a verdict from reaching the user; the unit tests keep the known paths clean.
  const languageIssues = reportLanguageIssues(markdown, locale);
  if (languageIssues.length) console.warn(`[delivery] report ${sessionId} (${locale}) still contains: ${languageIssues.join(" | ")}`);
  const appUrl = (deps.appUrl ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  const link = appUrl ? `${appUrl}/sessions/${sessionId}` : "";
  const tt = reportTranslator(locale);
  const title = tt("Decision: {project}", { project: report.project });
  const summary = deliverySummary(report, link, locale);
  // A Chinese PDF stays English until a CJK font is embedded (#268); the message and the Confluence page are Chinese.
  const docLocale = pdfLocale(locale);
  const pdf = Buffer.from(
    await reportPdf(
      docLocale === locale ? markdown : reportToMarkdown(report, docLocale),
      { title: reportTranslator(docLocale)("Final Decision Report – {project}", { project: report.project }), sessionId, createdAt: view.session.createdAt },
      report,
      // The same status line as the screen and the downloaded PDF (#268).
      { locale: docLocale, status: reportStatus(view, docLocale), verdictId: view.decision?.id ?? null },
    ),
  );
  const filename = `consyrion-decision-${sessionId}.pdf`;
  const doFetch = deps.fetch ?? fetch;

  let recipient = "";
  let connectionId: string | null = null;
  let secrets: string[] = [];
  let externalUrl: string | null = null;
  try {
    if (data.target === "email") {
      // Only members of this workspace receive decisions – no free addresses, so the feature cannot be used to mail outsiders.
      const members = new Set((await listMembers(db, actor)).map((m) => m.email.toLowerCase()));
      const outside = data.recipients.filter((r) => !members.has(r.toLowerCase()));
      if (outside.length) throw new DomainError("VALIDATION", `Only members of this workspace can receive decisions: ${outside.join(", ")}`);
      recipient = data.recipients.join(", ");
      const send = deps.sendMail === undefined ? await smtpSenderFromEnv() : deps.sendMail;
      if (!send) throw new Error("E-mail is not configured on this server (SMTP_URL)");
      await send({
        from: deps.mailFrom ?? process.env.MAIL_FROM ?? "CONSYRION AI <no-reply@consyrion.com>",
        to: data.recipients,
        subject: title,
        text: `${summary}\n\nThe full decision report is attached as PDF.`,
        attachments: [{ filename, content: pdf, contentType: "application/pdf" }],
      });
    } else {
      const connection = await deliveryConnectionForUse(db, actor, keyring, data.connectionId);
      if (connection.kind !== data.target) throw new DomainError("VALIDATION", `This is a ${connection.kind} connection`);
      connectionId = connection.id;
      secrets = [connection.secret];
      if (connection.kind === "telegram") {
        recipient = `Telegram: ${connection.label}`;
        const form = new FormData();
        form.set("chat_id", connection.config.chatId ?? "");
        // Telegram limits captions to 1,024 characters.
        form.set("caption", summary.slice(0, 1000));
        form.set("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
        const response = await doFetch(`https://api.telegram.org/bot${connection.secret}/sendDocument`, { method: "POST", body: form });
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!response.ok || !body.ok) throw new Error(`Telegram answered ${response.status}: ${body.description ?? "no description"}`);
      } else {
        const base = connection.config.baseUrl ?? "";
        recipient = `Confluence: ${connection.config.spaceKey} (${connection.label})`;
        const response = await doFetch(`${base}/wiki/rest/api/content`, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${connection.config.email}:${connection.secret}`).toString("base64")}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            type: "page",
            // Page titles are unique per space: the date and session make every decision its own page.
            title: `${title} (${view.session.createdAt.toISOString().slice(0, 10)}, ${sessionId.slice(-6)})`,
            space: { key: connection.config.spaceKey },
            body: {
              storage: {
                value:
                  reportStorageHtml(markdown) +
                  (link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(reportTranslator(locale)("Open in CONSYRION AI"))}</a></p>` : ""),
                representation: "storage",
              },
            },
          }),
        });
        const body = (await response.json().catch(() => ({}))) as { _links?: { base?: string; webui?: string }; message?: string };
        if (!response.ok) throw new Error(`Confluence answered ${response.status}: ${body.message ?? "no message"}`);
        externalUrl = body._links?.base && body._links.webui ? `${body._links.base}${body._links.webui}` : null;
      }
    }
  } catch (error) {
    if (error instanceof DomainError && error.code !== "CONFLICT") throw error;
    const message = safeError(error, secrets);
    await recordDelivery(db, actor, { sessionId, target: data.target, connectionId, recipient: recipient || data.target, status: "failed", error: message });
    return { status: "failed" as const, error: message };
  }
  await recordDelivery(db, actor, { sessionId, target: data.target, connectionId, recipient, status: "sent", externalUrl });
  if (data.remember) {
    await setProjectDeliveryDefault(
      db,
      actor,
      sessionId,
      data.target === "email" ? { target: "email", recipients: data.recipients } : { target: data.target, connectionId },
    );
  }
  return { status: "sent" as const, externalUrl };
}
