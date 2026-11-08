import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesFor } from "../../i18n/all-messages";
import type { View } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/sessions/s1", useSearchParams: () => new URLSearchParams() }));
const { SessionWorkspace } = await import("./workspace");

const base = (approvable: boolean, approvableProposalIds: string[]) =>
  ({
    session: { id: "s1", status: "awaiting_approval", mode: "independent_expert", tokensUsed: 1000, tokenBudget: 100000, currentPhase: "final_verdict", projectId: "p" },
    project: { id: "p", name: "Todo tags", deliveryDefault: null },
    brief: { version: 1 },
    participants: [],
    roles: [],
    requirementChecks: [],
    reviews: [],
    proposals: [],
    objections: [],
    scores: [],
    votes: [],
    approvals: [],
    previousDecisions: [],
    usage: [],
    messages: [],
    stages: [],
    participation: null,
    consensus: null,
    decision: { id: "d1", outcome: approvable ? "recommended" : "needs_verification", recommendedProposalId: null, matrix: { proposals: [] }, gateVersion: 2 },
    decisionStatus: { gateVersion: 2, readable: true, approvable, reason: null, canApproveRecommendation: approvable, approvableProposalIds },
  }) as unknown as View;

const render = (v: View, locale: "en" | "de" = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)}>
      <SessionWorkspace initial={v} canRun canApprove />
    </NextIntlClientProvider>,
  );

describe("session header: review status and approval status apart (#477)", () => {
  it("never says 'Awaiting your decision' next to a verdict that cannot be approved", () => {
    const html = render(base(false, []));
    expect(html).not.toContain("Awaiting your decision");
    expect(html).toContain("Awaiting your review");
    expect(html).toContain('data-testid="approval-status"');
    expect(html).toContain("No approvable proposal");
    expect(render(base(false, []), "de")).toContain("Kein freigebbarer Vorschlag");
  });

  it("keeps 'Awaiting your decision' when a proposal can be approved", () => {
    const html = render(base(true, ["pA"]));
    expect(html).toContain("Awaiting your decision");
    expect(html).not.toContain("approval-status");
  });
});
