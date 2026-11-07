import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clientIp, feedbackAdminRecipients, feedbackMail, notifyAdminsAboutFeedback } = await import("./feedback");
const { rateLimit } = await import("./rate-limit");

const report = {
  id: "fbk_1",
  kind: "bug" as const,
  subject: "Verdict tab empty",
  text: "Steps…",
  email: "alice@example.test",
  userId: "alice",
  page: "/sessions/ses_1",
  locale: "de",
  agent: "Safari",
  appVersion: "abc123",
};

describe("feedback e-mail to the admins (#295)", () => {
  it("reads ADMIN_EMAILS and builds a mail with all details and the inbox link", () => {
    expect(feedbackAdminRecipients({ ADMIN_EMAILS: " a@x.test, ,b@x.test,not-an-address" })).toEqual(["a@x.test", "b@x.test"]);
    expect(feedbackAdminRecipients({})).toEqual([]);
    const mail = feedbackMail(
      { ...report, subject: "Line\r\nBcc: evil@x.test" },
      { to: ["a@x.test"], from: "CONSYRION AI <no-reply@x.test>", appUrl: "https://app.example.test/" },
    );
    expect(mail.subject).toBe("CONSYRION Fehler: Line Bcc: evil@x.test");
    expect(mail.text).toContain("Von: alice@example.test (angemeldet)");
    expect(mail.text).toContain("Seite: /sessions/ses_1");
    expect(mail.text).toContain("https://app.example.test/admin/feedback?id=fbk_1");
    expect(feedbackMail({ ...report, kind: "contact", userId: null }, { to: [], from: "x", appUrl: "" }).subject).toMatch(/^CONSYRION Kontakt: /);
  });

  it("skips without recipients or SMTP and never throws when sending fails", async () => {
    const sendMail = vi.fn(async () => {});
    expect(await notifyAdminsAboutFeedback(report, { env: {}, sendMail })).toBe("skipped");
    expect(await notifyAdminsAboutFeedback(report, { env: { ADMIN_EMAILS: "a@x.test" }, sendMail: null })).toBe("skipped");
    expect(await notifyAdminsAboutFeedback(report, { env: { ADMIN_EMAILS: "a@x.test" }, sendMail })).toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["a@x.test"], subject: "CONSYRION Fehler: Verdict tab empty" }));
    const failing = vi.fn(async () => {
      throw new Error("connect ETIMEDOUT");
    });
    expect(await notifyAdminsAboutFeedback(report, { env: { ADMIN_EMAILS: "a@x.test" }, sendMail: failing })).toBe("failed");
  });

  it("limits visitors per IP address, 10 per day", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBe("unknown");
    const key = `feedback:ip:${clientIp(headers)}`;
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) rateLimit(key, 10, 86_400_000, now + i);
    expect(() => rateLimit(key, 10, 86_400_000, now + 11)).toThrow(/too many/i);
    expect(() => rateLimit(key, 10, 86_400_000, now + 86_400_000)).not.toThrow();
  });
});
