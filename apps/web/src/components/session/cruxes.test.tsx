import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import { CruxesCard } from "./cruxes-card";
import { deriveCruxes } from "./cruxes";
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
    { id: "pro_a", label: "A", authorParticipantId: "par_c", revisions: [{ version: 1, createdAt: t0 }, { version: 2, createdAt: "2026-11-05T10:20:00Z" }] },
    { id: "pro_b", label: "B", authorParticipantId: "par_d", revisions: [{ version: 1, createdAt: t0 }] },
  ],
  messages: [{ id: "msg_1", role: "security_expert" }],
  objections: [
    { id: "o_low", proposalId: "pro_a", raisedByParticipantId: "par_o", category: "maintainability", severity: "low", claim: "Naming is inconsistent", evidence: "", response: "Fixed", status: "refuted", createdAt: "2026-11-05T10:05:00Z" },
    { id: "o_block", proposalId: "pro_b", raisedByParticipantId: "par_o", sourceMessageId: "msg_1", category: "security", severity: "critical", claim: "Tenant data can leak", evidence: "Test shows shared cache", response: null, undefendedReason: "provider error (timeout)", status: "unresolved", blocking: true, reviewedByParticipantId: "par_c", resolutionReason: "Risk remains", createdAt: "2026-11-05T10:06:00Z" },
    { id: "o_moot", proposalId: "pro_a", raisedByParticipantId: "par_d", category: "functional", severity: "high", claim: "Regex is corrupted", evidence: "", response: "Conceded", conceded: true, status: "accepted", moot: { againstVersion: 1, currentVersion: 2 }, createdAt: "2026-11-05T10:07:00Z" },
    { id: "o_acc", proposalId: "pro_a", raisedByParticipantId: "par_o", category: "functional", severity: "high", claim: "Missing priority is not defaulted", evidence: "", response: "Disagree", status: "accepted", reviewedByParticipantId: "par_d", resolutionReason: "The claim is correct", createdAt: "2026-11-05T10:08:00Z" },
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
    expect(block!.claim).toMatchObject({ by: "claude-haiku-5-5".replace("claude-haiku-5-5", block!.claim.by), role: "Security Expert", evidence: "Test shows shared cache" });
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
});
