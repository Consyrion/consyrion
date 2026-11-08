import "server-only";
import { smtpSenderFromEnv, type MailMessage } from "./delivery";
import { logger } from "./logger";

/**
 * E-mail verification for email/password accounts. It is on whenever the server can send e-mail (`SMTP_URL`), so an
 * address is proven before it can sign in or count as a platform admin. An operator can switch it off explicitly with
 * `REQUIRE_EMAIL_VERIFICATION=false`. Without SMTP it stays off: nobody could ever receive the link and every new
 * account would be locked out.
 */
export function emailVerificationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase() === "false") return false;
  return Boolean(env.SMTP_URL?.trim());
}

/** How long a verification link stays valid. */
export const VERIFICATION_LINK_HOURS = 24;

/** The verification e-mail (German and English: the locale of a new account is not known yet). Plain text only. */
export function verificationMail(input: { to: string; name: string; url: string }, options: { from: string }): MailMessage {
  const name = input.name.replace(/[\r\n]+/g, " ").trim();
  return {
    from: options.from,
    to: [input.to],
    subject: "CONSYRION AI: E-Mail-Adresse bestätigen / Confirm your e-mail address",
    text: [
      `Hallo ${name || ""}`.trim() + ",",
      "",
      "bitte bestätige deine E-Mail-Adresse für CONSYRION AI mit diesem Link:",
      input.url,
      "",
      `Der Link ist ${VERIFICATION_LINK_HOURS} Stunden gültig. Wenn du kein Konto erstellt hast, ignoriere diese E-Mail.`,
      "",
      "—",
      "",
      `Hello ${name || ""}`.trim() + ",",
      "",
      "please confirm your e-mail address for CONSYRION AI with this link:",
      input.url,
      "",
      `The link is valid for ${VERIFICATION_LINK_HOURS} hours. If you did not create an account, ignore this e-mail.`,
    ].join("\n"),
    attachments: [],
  };
}

export interface VerificationDeps {
  sendMail?: ((message: MailMessage) => Promise<void>) | null;
  env?: Record<string, string | undefined>;
}

/**
 * Sends the verification link; resolves to "sent", "skipped" (no SMTP) or "failed" and never throws, so a mail outage
 * does not break sign-up. The user gets a new link with the next sign-in attempt. The link itself is never logged.
 */
export async function sendVerificationMail(
  input: { to: string; name: string; url: string },
  deps: VerificationDeps = {},
): Promise<"sent" | "skipped" | "failed"> {
  const env = deps.env ?? process.env;
  try {
    const send = deps.sendMail === undefined ? await smtpSenderFromEnv(env) : deps.sendMail;
    if (!send) return "skipped";
    await send(verificationMail(input, { from: env.MAIL_FROM ?? "CONSYRION AI <no-reply@consyrion.com>" }));
    return "sent";
  } catch (error) {
    logger.warn("Verification e-mail failed", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return "failed";
  }
}

/** Password reset (#395) needs a working mail server; without SMTP nobody could receive the link. */
export function passwordResetEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SMTP_URL?.trim());
}

/** How long a password reset link stays valid. */
export const PASSWORD_RESET_LINK_MINUTES = 60;

/** The password reset e-mail (German and English, plain text). */
export function passwordResetMail(input: { to: string; name: string; url: string }, options: { from: string }): MailMessage {
  const name = input.name.replace(/[\r\n]+/g, " ").trim();
  return {
    from: options.from,
    to: [input.to],
    subject: "CONSYRION AI: Passwort zurücksetzen / Reset your password",
    text: [
      `Hallo ${name || ""}`.trim() + ",",
      "",
      "mit diesem Link setzt du ein neues Passwort für CONSYRION AI. Danach sind alle bisherigen Anmeldungen beendet:",
      input.url,
      "",
      `Der Link ist ${PASSWORD_RESET_LINK_MINUTES} Minuten gültig und funktioniert einmal. Wenn du das nicht angefordert hast, ignoriere diese E-Mail – dein Passwort bleibt unverändert.`,
      "",
      "—",
      "",
      `Hello ${name || ""}`.trim() + ",",
      "",
      "use this link to set a new password for CONSYRION AI. All existing sign-ins end afterwards:",
      input.url,
      "",
      `The link is valid for ${PASSWORD_RESET_LINK_MINUTES} minutes and works once. If you did not ask for this, ignore this e-mail – your password stays unchanged.`,
    ].join("\n"),
    attachments: [],
  };
}

/** Sends the reset link; like the verification mail it never throws and never logs the link. */
export async function sendPasswordResetMail(
  input: { to: string; name: string; url: string },
  deps: VerificationDeps = {},
): Promise<"sent" | "skipped" | "failed"> {
  const env = deps.env ?? process.env;
  try {
    const send = deps.sendMail === undefined ? await smtpSenderFromEnv(env) : deps.sendMail;
    if (!send) return "skipped";
    await send(passwordResetMail(input, { from: env.MAIL_FROM ?? "CONSYRION AI <no-reply@consyrion.com>" }));
    return "sent";
  } catch (error) {
    logger.warn("Password reset e-mail failed", { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    return "failed";
  }
}
