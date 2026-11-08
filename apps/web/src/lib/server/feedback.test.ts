import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clientIp, feedbackAdminRecipients, feedbackMail, feedbackReplyMail, notifyAdminsAboutFeedback, screenshotAttachment, sendFeedbackReplyMail } =
  await import("./feedback");
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

describe("feedback stage 2 (#295): screenshot attachment and reply e-mail", () => {
  it("attaches a stored screenshot to the admin mail and ignores malformed values", () => {
    const png = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
    const mail = feedbackMail({ ...report, screenshot: png }, { to: ["a@x.test"], from: "x", appUrl: "" });
    expect(mail.attachments).toEqual([{ filename: "screenshot.png", content: Buffer.from("png-bytes"), contentType: "image/png" }]);
    expect(mail.text).toContain("Screenshot: angehängt");
    expect(feedbackMail(report, { to: [], from: "x", appUrl: "" }).attachments).toEqual([]);
    expect(screenshotAttachment("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(screenshotAttachment("data:image/jpeg;base64,AAAA")?.filename).toBe("screenshot.jpg");
  });

  it("writes the reply in the report's language, quotes the message and links My reports only for accounts", () => {
    const base = { email: "alice@example.test", subject: "Verdict\r\nBcc: x@y", text: "Line 1\nLine 2", reply: "Fixed!", hasAccount: true };
    const de = feedbackReplyMail({ ...base, locale: "de" }, { from: "CONSYRION AI <no-reply@x.test>", replyTo: "team@x.test", appUrl: "https://app.x.test/" });
    expect(de.to).toEqual(["alice@example.test"]);
    expect(de.replyTo).toBe("team@x.test");
    expect(de.subject).toBe("Re: Verdict Bcc: x@y");
    expect(de.text).toContain("Das Team von CONSYRION AI hat auf deine Nachricht geantwortet:");
    expect(de.text).toContain("> Line 1\n> Line 2");
    expect(de.text).toContain("https://app.x.test/settings/feedback");
    const visitor = feedbackReplyMail({ ...base, locale: "fr-CH", hasAccount: false }, { from: "x", appUrl: "https://app.x.test" });
    expect(visitor.text).toContain("L'équipe CONSYRION AI");
    expect(visitor.text).not.toContain("/settings/feedback");
    expect(feedbackReplyMail({ ...base, locale: null }, { from: "x", appUrl: "" }).text).toContain("The CONSYRION AI team");
  });

  it("sends the reply with Reply-To of the first admin, skips without SMTP and never throws", async () => {
    const reply = { email: "g@x.test", locale: "en", subject: "Hi", text: "Q", reply: "A", hasAccount: false };
    const sendMail = vi.fn(async () => {});
    expect(await sendFeedbackReplyMail(reply, { env: { ADMIN_EMAILS: "root@x.test" }, sendMail })).toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["g@x.test"], replyTo: "root@x.test" }));
    expect(await sendFeedbackReplyMail(reply, { env: {}, sendMail: null })).toBe("skipped");
    const failing = vi.fn(async () => {
      throw new Error("smtp down");
    });
    expect(await sendFeedbackReplyMail(reply, { env: {}, sendMail: failing })).toBe("failed");
  });
});
