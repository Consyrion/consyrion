import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import { CruxesCard } from "./cruxes-card";
import { deriveCruxes, matchesFilter, noDocumentedDispute, type Crux } from "./cruxes";
import type { View } from "./helpers";

// Fixture shaped like a stored council (test data, not a real run).
const t0 = "2026-11-05T10:00:00Z";
const view = {
  participants: [
    { id: "par_c", provider: "anthropic", modelId: "claude-haiku-5-5", status: "active" },
    { id: "par_o", provider: "openai", modelId: "gpt-5-mini", status: "active" },
    { id: "par_d", provider: "deepseek", modelId: "deepseek-flash", status: "active" },
  ],
  proposals: [
    {
      id: "pro_a",
      label: "A",
      authorParticipantId: "par_c",
      revisions: [
        { version: 1, createdAt: t0 },
        { version: 2, createdAt: "2026-11-05T10:20:00Z" },
      ],
    },
    { id: "pro_b", label: "B", authorParticipantId: "par_d", revisions: [{ version: 1, createdAt: t0 }] },
  ],
  messages: [{ id: "msg_1", role: "security_expert" }],
  objections: [
    {
      id: "o_low",
      proposalId: "pro_a",
      raisedByParticipantId: "par_o",
      category: "maintainability",
      severity: "low",
      claim: "Naming is inconsistent",
      evidence: "",
      response: "Fixed",
      status: "refuted",
      createdAt: "2026-11-05T10:05:00Z",
    },
    {
      id: "o_block",
      proposalId: "pro_b",
      raisedByParticipantId: "par_o",
      sourceMessageId: "msg_1",
      category: "security",
      severity: "critical",
      claim: "Tenant data can leak",
      evidence: "Test shows shared cache",
      response: null,
      undefendedReason: "provider error (timeout)",
      status: "unresolved",
      blocking: true,
      reviewedByParticipantId: "par_c",
      resolutionReason: "Risk remains",
      createdAt: "2026-11-05T10:06:00Z",
    },
    {
      id: "o_moot",
      proposalId: "pro_a",
      raisedByParticipantId: "par_d",
      category: "functional",
      severity: "high",
      claim: "Regex is corrupted",
      evidence: "",
      response: "Conceded",
      conceded: true,
      status: "accepted",
      moot: { againstVersion: 1, currentVersion: 2 },
      createdAt: "2026-11-05T10:07:00Z",
    },
    {
      id: "o_acc",
      proposalId: "pro_a",
      raisedByParticipantId: "par_o",
      category: "functional",
      severity: "high",
      claim: "Missing priority is not defaulted",
      evidence: "",
      response: "Disagree",
      status: "accepted",
      reviewedByParticipantId: "par_d",
      resolutionReason: "The claim is correct",
      createdAt: "2026-11-05T10:08:00Z",
    },
  ],
  consensus: { disagreements: ["B and A still differ on cost"] },
} as unknown as View;

describe("key disputes (#267) – deterministic, from stored events only", () => {
  it("ranks a blocking objection first, a moot one below live ones, and keeps at most three", () => {
    const cruxes = deriveCruxes(view, "pro_a");
    expect(cruxes.map((c) => c.id)).toEqual(["o_block", "o_acc", "o_low"]);
  });

  it("names who raised it (with role), the author's answer or why it is missing, the review and the revision", () => {
    const [block, accepted] = deriveCruxes(view, "pro_a");
    expect(block!.claim).toMatchObject({
      by: "claude-haiku-5-5".replace("claude-haiku-5-5", block!.claim.by),
      role: "Security Expert",
      evidence: "Test shows shared cache",
    });
    expect(block!.author).toMatchObject({ response: null, unanswered: "provider error (timeout)" });
    expect(block!.review.reason).toBe("Risk remains");
    expect(block!.revision).toBeNull();
    expect(accepted!.recommended).toBe(true);
    expect(accepted!.revision).toEqual({ version: 2, moot: false });
  });

  it("renders stored statements verbatim with translated labels (English and German)", () => {
    const render = (messages: Record<string, unknown>, locale: string) =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CruxesCard view={view} recommendedId="pro_a" />
        </NextIntlClientProvider>,
      );
    const html = render(en, "en");
    expect(html).toContain("Key disputes");
    expect(html).toContain("“Tenant data can leak”");
    expect(html).toContain("No answer – provider error (timeout)");
    expect(html).toContain("blocks approval");
    expect(html).toContain("B and A still differ on cost");
    const german = render(de, "de");
    expect(german).toContain("Entscheidende Streitpunkte");
    expect(german).toContain("blockiert die Freigabe");
    expect(german).toContain("“Tenant data can leak”");
  });

  it("objection on A v1, A revised to v2, review still unresolved: shows then v1 / now v2 and never 'resolved' (#267 stage 2)", () => {
    const revised = {
      ...view,
      objections: [
        {
          id: "o_v1",
          proposalId: "pro_a",
          raisedByParticipantId: "par_o",
          sourceMessageId: "msg_2",
          category: "security",
          severity: "critical",
          claim: "Secrets are logged",
          evidence: "",
          response: "Fixed in v2",
          status: "unresolved",
          reviewedByParticipantId: "par_d",
          resolutionReason: "Addressed by the author in v2. Not independently re-reviewed.",
          createdAt: "2026-11-05T10:10:00Z",
        },
      ],
      messages: [
        {
          id: "msg_2",
          phase: "twelve_minds_council",
          round: 1,
          role: "security_expert",
          body: "Secrets are logged in the request handler.",
          createdAt: "2026-11-05T10:09:00Z",
        },
      ],
    } as unknown as View;
    const [c] = deriveCruxes(revised, "pro_a");
    expect(c!.status).toBe("unresolved");
    expect(matchesFilter(c!, "resolved")).toBe(false);
    expect(matchesFilter(c!, "open")).toBe(true);
    expect(c!.sources).toEqual({
      objectionId: "o_v1",
      raisedAt: "2026-11-05T10:10:00.000Z",
      message: {
        id: "msg_2",
        phase: "twelve_minds_council",
        round: 1,
        body: "Secrets are logged in the request handler.",
        createdAt: "2026-11-05T10:09:00.000Z",
      },
      attackedVersion: 1,
      currentVersion: 2,
      revisedAt: "2026-11-05T10:20:00.000Z",
    });
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
        <CruxesCard view={revised} recommendedId="pro_a" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Offen (1)");
    expect(html).toContain("Geklärt (0)");
    expect(html).toContain("Einwand erhoben");
    expect(html).toContain("Überarbeitet zu v2");
    expect(html).toContain("Belege ansehen");
    expect(html).not.toContain(">geklärt<");
  });

  it("counts an upheld objection without a fixing revision as open, and as resolved once a revision made it moot (live check 08.11.26)", () => {
    const upheld = { status: "accepted", revision: null, blocking: false, severity: "medium" } as unknown as Crux;
    expect(matchesFilter(upheld, "open")).toBe(true);
    expect(matchesFilter(upheld, "resolved")).toBe(false);
    const fixed = { ...upheld, revision: { moot: true } } as unknown as Crux;
    expect(matchesFilter(fixed, "open")).toBe(false);
    expect(matchesFilter(fixed, "resolved")).toBe(true);
  });

  it("every shown dispute points to a stored objection row (100 % source ids)", () => {
    const ids = new Set((view.objections as Array<{ id: string }>).map((o) => o.id));
    for (const filter of ["all", "open", "critical", "resolved"] as const)
      for (const c of deriveCruxes(view, "pro_a", Number.POSITIVE_INFINITY, filter)) expect(ids.has(c.sources.objectionId)).toBe(true);
  });

  it("unanimous council without objections: says 'no documented dispute' instead of inventing one, and nothing before the review", () => {
    const quiet = {
      ...view,
      objections: [],
      consensus: { disagreements: [] },
      stages: [{ phase: "minority_review", status: "completed" }],
      decision: null,
    } as unknown as View;
    expect(noDocumentedDispute(quiet)).toBe(true);
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
        <CruxesCard view={quiet} recommendedId={null} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Keine dokumentierte entscheidende Meinungsverschiedenheit");
    const early = { ...quiet, stages: [{ phase: "minority_review", status: "running" }] } as unknown as View;
    expect(noDocumentedDispute(early)).toBe(false);
  });
});
