import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { emailVerificationEnabled, passwordResetEnabled, passwordResetMail, sendPasswordResetMail, sendVerificationMail, verificationMail } = await import("./email-verification");
const { isPlatformAdmin, platformAdminOptions } = await import("./admin");

const SMTP = "smtp://user:pass@mail.example.test:587";

describe("e-mail verification", () => {
  it("is on exactly when SMTP is configured, unless the operator switches it off", () => {
    expect(emailVerificationEnabled({})).toBe(false);
    expect(emailVerificationEnabled({ SMTP_URL: "  " })).toBe(false);
    expect(emailVerificationEnabled({ SMTP_URL: SMTP })).toBe(true);
    expect(emailVerificationEnabled({ SMTP_URL: SMTP, REQUIRE_EMAIL_VERIFICATION: "FALSE" })).toBe(false);
    // Without SMTP nobody could receive the link, so "true" alone does not lock everyone out.
    expect(emailVerificationEnabled({ REQUIRE_EMAIL_VERIFICATION: "true" })).toBe(false);
  });

  it("builds a plain-text mail with the link and no header injection through the name", () => {
    const mail = verificationMail(
      { to: "mia@example.test", name: "Mia\r\nBcc: evil@x.test", url: "https://app.example.test/api/auth/verify-email?token=t" },
      { from: "X <no-reply@x.test>" },
    );
    expect(mail.to).toEqual(["mia@example.test"]);
    expect(mail.text).toContain("https://app.example.test/api/auth/verify-email?token=t");
    expect(mail.text).toContain("Hallo Mia Bcc: evil@x.test,");
    expect(mail.text).not.toMatch(/\r/);
    expect(mail.attachments).toEqual([]);
  });

  it("skips without SMTP and never throws when sending fails", async () => {
    const input = { to: "mia@example.test", name: "Mia", url: "https://x.test/v" };
    const sendMail = vi.fn(async () => {});
    expect(await sendVerificationMail(input, { env: {}, sendMail: null })).toBe("skipped");
    expect(await sendVerificationMail(input, { env: { MAIL_FROM: "A <a@x.test>" }, sendMail })).toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "A <a@x.test>", to: ["mia@example.test"] }));
    const failing = vi.fn(async () => {
      throw new Error("connection refused");
    });
    expect(await sendVerificationMail(input, { env: {}, sendMail: failing })).toBe("failed");
  });
});

describe("platform admin and verified e-mail", () => {
  const admins = { PLATFORM_ADMIN_EMAILS: "Root@Example.test" };

  it("does not grant admin to an unverified admin address while verification is on", () => {
    const env = { ...admins, SMTP_URL: SMTP };
    expect(platformAdminOptions(env)).toEqual({ requireVerifiedEmail: true });
    expect(isPlatformAdmin({ email: "root@example.test", emailVerified: false }, env)).toBe(false);
    expect(isPlatformAdmin({ email: "root@example.test" }, env)).toBe(false);
    expect(isPlatformAdmin({ email: "root@example.test", emailVerified: true }, env)).toBe(true);
    expect(isPlatformAdmin({ email: "other@example.test", emailVerified: true }, env)).toBe(false);
  });

  it("requires a verified address also when the server cannot send e-mail (#404)", () => {
    expect(platformAdminOptions(admins)).toEqual({ requireVerifiedEmail: true });
    expect(isPlatformAdmin({ email: "ROOT@example.test", emailVerified: false }, admins)).toBe(false);
    // Google/GitHub sign-ins are verified by the provider.
    expect(isPlatformAdmin({ email: "ROOT@example.test", emailVerified: true }, admins)).toBe(true);
    expect(isPlatformAdmin(null, admins)).toBe(false);
  });

  it("lets a server without SMTP opt out explicitly, but never while verification is on", () => {
    const optOut = { ...admins, PLATFORM_ADMIN_ALLOW_UNVERIFIED: "true" };
    expect(platformAdminOptions(optOut)).toEqual({ requireVerifiedEmail: false });
    expect(isPlatformAdmin({ email: "root@example.test", emailVerified: false }, optOut)).toBe(true);
    expect(platformAdminOptions({ ...optOut, SMTP_URL: SMTP })).toEqual({ requireVerifiedEmail: true });
  });
});

describe("password reset (#395)", () => {
  it("is offered exactly when SMTP is configured", () => {
    expect(passwordResetEnabled({})).toBe(false);
    expect(passwordResetEnabled({ SMTP_URL: " " })).toBe(false);
    // Independent of the verification switch: a reset needs only a mail server.
    expect(passwordResetEnabled({ SMTP_URL: SMTP, REQUIRE_EMAIL_VERIFICATION: "false" })).toBe(true);
  });

  it("builds a plain-text mail with the link, its lifetime and no header injection through the name", () => {
    const mail = passwordResetMail({ to: "mia@example.test", name: "Mia\r\nBcc: evil@x.test", url: "https://app.example.test/api/auth/reset-password/tok?callbackURL=%2Freset-password" }, { from: "X <no-reply@x.test>" });
    expect(mail.to).toEqual(["mia@example.test"]);
    expect(mail.subject).toMatch(/Passwort zurücksetzen/);
    expect(mail.text).toContain("https://app.example.test/api/auth/reset-password/tok?callbackURL=%2Freset-password");
    expect(mail.text).toContain("60 Minuten");
    expect(mail.text).not.toMatch(/\r/);
  });

  it("skips without SMTP and never throws when sending fails", async () => {
    const input = { to: "mia@example.test", name: "Mia", url: "https://x.test/r" };
    expect(await sendPasswordResetMail(input, { env: {}, sendMail: null })).toBe("skipped");
    const sendMail = vi.fn(async () => {});
    expect(await sendPasswordResetMail(input, { env: {}, sendMail })).toBe("sent");
    const failing = vi.fn(async () => {
      throw new Error("connection refused");
    });
    expect(await sendPasswordResetMail(input, { env: {}, sendMail: failing })).toBe("failed");
  });
});
