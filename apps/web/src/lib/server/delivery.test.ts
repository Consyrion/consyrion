import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createDatabase,
  createDeliveryConnection,
  createOrganization,
  createProject,
  ensurePersonalOrganization,
  listDeliveries,
  listDeliveryConnections,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The report itself is tested in the council package; here a fixed report keeps the tests on delivery.
vi.mock("@consyrium/council", async () => ({
  // The real report wording (#322); only the session data is mocked.
  reportTranslator: (await vi.importActual<typeof import("@consyrium/council")>("@consyrium/council")).reportTranslator,
  reportLanguageIssues: (await vi.importActual<typeof import("@consyrium/council")>("@consyrium/council")).reportLanguageIssues,
  blockedExplanation: (await vi.importActual<typeof import("@consyrium/council")>("@consyrium/council")).blockedExplanation,
  nextAction: (await vi.importActual<typeof import("@consyrium/council")>("@consyrium/council")).nextAction,
  outcomeLine: (await vi.importActual<typeof import("@consyrium/council")>("@consyrium/council")).outcomeLine,
  getSessionView: vi.fn(async (_db: unknown, _actor: unknown, id: string) => ({
    session: { id, createdAt: new Date("2026-10-27T12:00:00Z") },
    decision: { outcome: "recommended" },
  })),
  buildDecisionReport: vi.fn(() => ({
    project: "Vereins-Streaming",
    outcomeText: "A solution is recommended.",
    recommendedSolution: { label: "C", title: "Pi-MVP mit 720p" },
    evaluationMatrix: { confidence: "low" },
  })),
  reportToMarkdown: vi.fn(() => "# Final Decision Report – Vereins-Streaming\n\n## Outcome\nA solution is recommended.\n\n- Größere Änderung"),
}));
const { deliverDecision, deliverySummary, reportStorageHtml, smtpOptions } = await import("./delivery");
type MailMessage = import("./delivery").MailMessage;

const BOT_TOKEN = "123456789:AAH-test-token-abcdefghijklmnopqrstuvw";
let handle: DatabaseHandle;
let actor: ActorContext;
let sessionId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "owner@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  const project = await createProject(handle.db, actor, {
    name: "Streaming",
    type: "architecture",
    brief: { idea: "Wie streamen wir die Vereinsspiele live und günstig?" },
  });
  const brief = (await handle.db.select().from(schema.projectBrief)).find((b) => b.projectId === project.id);
  sessionId = "ses_delivery_test";
  await handle.db.insert(schema.councilSession).values({
    id: sessionId,
    organizationId: org.id,
    projectId: project.id,
    briefId: brief!.id,
    mode: "consensus",
    policy: {},
    policyVersion: 1,
    tokenBudget: 1000,
    createdById: "u1",
  });
});
afterEach(async () => handle.close());

async function telegram() {
  return createDeliveryConnection(handle.db, actor, keyring, { kind: "telegram", label: "Team chat", chatId: "-1001234567890", secret: BOT_TOKEN });
}

describe("sending decisions (#165)", () => {
  it("stores connections encrypted and never returns the secret", async () => {
    const connection = await telegram();
    expect(JSON.stringify(connection)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(await listDeliveryConnections(handle.db, actor))).not.toContain(BOT_TOKEN);
    const [row] = await handle.db.select().from(schema.deliveryConnection);
    expect(row!.encryptedSecret).not.toContain(BOT_TOKEN);
    await expect(createDeliveryConnection(handle.db, actor, keyring, { kind: "telegram", label: "x", chatId: "abc", secret: BOT_TOKEN })).rejects.toMatchObject(
      { code: "VALIDATION" },
    );
  });

  it("posts the verdict and the PDF to Telegram and logs it without the token", async () => {
    const connection = await telegram();
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`);
      const form = init.body as FormData;
      expect(form.get("chat_id")).toBe("-1001234567890");
      expect(String(form.get("caption"))).toContain("Recommended: Proposal C – Pi-MVP mit 720p");
      expect((form.get("document") as File).type).toBe("application/pdf");
      return new Response(JSON.stringify({ ok: true }));
    });
    const result = await deliverDecision(
      handle.db,
      actor,
      keyring,
      sessionId,
      { target: "telegram", connectionId: connection.id },
      { fetch: fetchMock as unknown as typeof fetch, appUrl: "https://app.consyrium.com" },
    );
    expect(result).toEqual({ status: "sent", externalUrl: null });
    const [entry] = await listDeliveries(handle.db, actor, sessionId);
    expect(entry).toMatchObject({ target: "telegram", status: "sent", recipient: "Telegram: Team chat" });
  });

  it("logs a failed send with a reason but without the token, and the retry works", async () => {
    const connection = await telegram();
    const failing = vi.fn(async () => {
      throw new Error(`request to https://api.telegram.org/bot${BOT_TOKEN}/sendDocument failed`);
    });
    const failed = await deliverDecision(
      handle.db,
      actor,
      keyring,
      sessionId,
      { target: "telegram", connectionId: connection.id },
      { fetch: failing as unknown as typeof fetch },
    );
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain(BOT_TOKEN);
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    expect(
      (
        await deliverDecision(
          handle.db,
          actor,
          keyring,
          sessionId,
          { target: "telegram", connectionId: connection.id },
          { fetch: ok as unknown as typeof fetch },
        )
      ).status,
    ).toBe("sent");
    const log = await listDeliveries(handle.db, actor, sessionId);
    expect(log.map((d) => d.status).sort()).toEqual(["failed", "sent"]);
    expect(JSON.stringify(log)).not.toContain(BOT_TOKEN);
    const audit = await handle.db.select().from(schema.auditEvent);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["decision.delivered", "decision.delivery_failed"]));
  });

  it("creates a Confluence page in the space and links it", async () => {
    const connection = await createDeliveryConnection(handle.db, actor, keyring, {
      kind: "confluence",
      label: "Decisions",
      baseUrl: "https://example-team.atlassian.net/",
      spaceKey: "DEC",
      email: "owner@example.test",
      secret: "ATATT-test-token-123456",
    });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://example-team.atlassian.net/wiki/rest/api/content");
      expect((init.headers as Record<string, string>).authorization).toBe(
        `Basic ${Buffer.from("owner@example.test:ATATT-test-token-123456").toString("base64")}`,
      );
      const body = JSON.parse(String(init.body));
      expect(body.space).toEqual({ key: "DEC" });
      expect(body.body.storage.value).toContain("<li>Größere Änderung</li>");
      return new Response(JSON.stringify({ _links: { base: "https://example-team.atlassian.net/wiki", webui: "/spaces/DEC/pages/1" } }));
    });
    const result = await deliverDecision(
      handle.db,
      actor,
      keyring,
      sessionId,
      { target: "confluence", connectionId: connection.id, remember: true },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result).toEqual({ status: "sent", externalUrl: "https://example-team.atlassian.net/wiki/spaces/DEC/pages/1" });
    // "Use as default" stores the target on the project.
    const [project] = await handle.db.select().from(schema.project);
    expect(project!.deliveryDefault).toEqual({ target: "confluence", connectionId: connection.id });
  });

  it("e-mails only workspace members, with the PDF attached, and reports a missing mail server", async () => {
    await expect(
      deliverDecision(handle.db, actor, keyring, sessionId, { target: "email", recipients: ["stranger@example.test"] }, { sendMail: vi.fn() }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const sendMail = vi.fn(async (_message: MailMessage) => undefined);
    expect((await deliverDecision(handle.db, actor, keyring, sessionId, { target: "email", recipients: ["owner@example.test"] }, { sendMail })).status).toBe(
      "sent",
    );
    const message = sendMail.mock.calls[0]![0];
    expect(message.to).toEqual(["owner@example.test"]);
    expect(message.attachments[0]!.contentType).toBe("application/pdf");
    expect(message.attachments[0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    const missing = await deliverDecision(handle.db, actor, keyring, sessionId, { target: "email", recipients: ["owner@example.test"] }, { sendMail: null });
    expect(missing).toEqual({ status: "failed", error: "E-mail is not configured on this server (SMTP_URL)" });
  });

  it("never lets another workspace use a connection", async () => {
    const connection = await telegram();
    await handle.db.insert(schema.user).values({ id: "u2", name: "Other", email: "other@example.test" });
    const other = await resolveActor(handle.db, "u2", (await createOrganization(handle.db, "u2", { name: "Other" })).id);
    await expect(
      deliverDecision(handle.db, other, keyring, sessionId, { target: "telegram", connectionId: connection.id }, { fetch: vi.fn() as unknown as typeof fetch }),
    ).rejects.toBeTruthy();
  });

  it("reads SMTP_URL with STARTTLS on 587 or SSL on 465 and short timeouts", () => {
    expect(smtpOptions("smtp://support%40consyrium.com:p%40ss%2Fw@smtp.hostinger.com:587")).toMatchObject({
      host: "smtp.hostinger.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "support@consyrium.com", pass: "p@ss/w" },
      connectionTimeout: 15_000,
    });
    expect(smtpOptions("smtps://u:p@smtp.example.test")).toMatchObject({ port: 465, secure: true });
  });

  it("writes the report as Confluence storage HTML with escaped text", () => {
    expect(reportStorageHtml("## A <b>\n- x & y\n| H |\n|---|\n| 1 |")).toBe(
      "<h2>A &lt;b&gt;</h2><ul><li>x &amp; y</li></ul><table><tbody><tr><th>H</th></tr><tr><td>1</td></tr></tbody></table>",
    );
  });

  it("never sends a not-approvable verdict as a recommendation (#181, stage 1)", () => {
    type Report = Parameters<typeof deliverySummary>[0];
    const base = { project: "P", recommendedSolution: { label: "A", title: "T" }, evaluationMatrix: null } as unknown as Report;
    const blocked = deliverySummary(
      { ...base, outcomeText: "Needs verification – …", decisionFormat: { gateVersion: 1, approvable: false, reason: "Needs verification – …" } } as Report,
      "",
    );
    expect(blocked).toContain("Leading proposal (not approvable): Proposal A – T");
    expect(blocked).toContain("Not approvable: this verdict cannot be approved or built.");
    expect(blocked).not.toContain("Recommended:");
    const legacy = deliverySummary(
      { ...base, outcomeText: "A solution is recommended.", decisionFormat: { gateVersion: 1, approvable: true, reason: null } } as Report,
      "",
    );
    expect(legacy).toContain("Recommended: Proposal A – T");
  });

  it("writes the summary in the connection's language (Telegram live test 08.11.26)", () => {
    type Report = Parameters<typeof deliverySummary>[0];
    const report = {
      project: "P",
      recommendedSolution: null,
      evaluationMatrix: { confidence: "reduced" },
      outcomeText: "Tie – the leading solutions are too close to call; a human must choose.",
      decisionFormat: { gateVersion: 2, approvable: true, reason: null },
    } as unknown as Report;
    const de = deliverySummary(report, "", "de");
    expect(de).not.toContain("Tie – the leading");
    expect(de).toContain("Zuversicht: eingeschränkt");
    expect(deliverySummary(report, "")).toContain("Confidence: reduced");
  });
});
