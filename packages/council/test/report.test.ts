import { describe, expect, it } from "vitest";
import { buildDecisionReport, reportToMarkdown, type SessionView } from "../src";

// Shape of the real run ses_3616f7c9… (#150): B v1 was Go + Redis on one CX22, v2 took over Django + PostgreSQL.
const revision = (id: string, version: number, content: Record<string, unknown>, createdAt: string) => ({
  id,
  proposalId: id.split("-")[0],
  version,
  content,
  createdAt: new Date(createdAt),
  changes: [],
  keptPosition: false,
  phase: "consensus_round",
});
const goRedis = {
  title: "Einfaches Go-basiertes Buchungssystem mit Redis-Locks",
  summary: "Go-Backend mit Redis für Locks auf einer einzelnen CX22.",
  architecture: "Go, Redis-Locks, SELECT FOR UPDATE, eine CX22.",
  risks: [],
};
const django = {
  title: "Django-PWA mit PostgreSQL-Exclusion-Constraint und Warm-Standby",
  summary: "Django mit PostgreSQL-Exclusion-Constraint auf zwei Servern mit Warm-Standby.",
  architecture: "Django-Monolith, PostgreSQL-Exclusion-Constraint, Standby-Server.",
  risks: [],
};
const view = {
  project: { name: "Buchung" },
  session: { id: "ses_1", mode: "independent_expert", status: "awaiting_approval", tokensUsed: 0, tokenBudget: 400_000 },
  brief: { version: 1 },
  participants: [],
  proposals: [
    {
      id: "A",
      label: "A",
      authorParticipantId: "p1",
      revisions: [revision("A-1", 1, { ...django, title: "Django-Monolith mit PostgreSQL-Exclusion-Constraint" }, "2026-10-27T10:00:00Z")],
    },
    {
      id: "B",
      label: "B",
      authorParticipantId: "p2",
      revisions: [revision("B-1", 1, goRedis, "2026-10-27T10:00:00Z"), revision("B-2", 2, django, "2026-10-27T10:30:00Z")],
    },
  ],
  objections: [
    {
      id: "o1",
      proposalId: "B",
      claim: "Redis für distributed Locks + Go + Keycloak",
      status: "accepted",
      createdAt: new Date("2026-10-27T10:10:00Z"),
      raisedByParticipantId: "p1",
      category: "architecture",
      severity: "high",
      response: null,
      blocking: false,
    },
    {
      id: "o2",
      proposalId: "B",
      claim: "Der Warm-Standby braucht einen getesteten Failover",
      status: "unresolved",
      createdAt: new Date("2026-10-27T10:40:00Z"),
      raisedByParticipantId: "p1",
      category: "operations",
      severity: "medium",
      response: null,
      blocking: false,
    },
  ],
  messages: [],
  scores: [],
  approvals: [],
  stages: [],
  usage: [],
  decision: { outcome: "recommended", recommendedProposalId: "B", matrix: null, gateVersion: 1 },
  consensus: null,
} as unknown as SessionView;

describe("decision report after an architecture change (#150)", () => {
  it("does not list objections against the replaced revision as remaining risks, and names the change", () => {
    const report = buildDecisionReport(view);
    expect(report.remainingRisks.join(" ")).not.toContain("Redis");
    expect(report.remainingRisks).toContain("Der Warm-Standby braucht einen getesteten Failover (unresolved objection)");
    expect(report.mootObjections).toEqual([
      expect.stringContaining("Redis für distributed Locks + Go + Keycloak – raised against v1; no longer applies to v2"),
    ]);
    expect(report.recommendedSolution!.architectureChange).toEqual({ fromVersion: 1, toVersion: 2, adoptedFrom: ["A"] });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("**Architecture change:** revision v2 replaced the solution of v1; it resembles Proposal A.");
    expect(markdown).toContain("### No longer applicable after the revision");
  });
});

describe("objections in the decision report (#169, #173)", () => {
  // Council C (ses_4df40e35…): the stored `claim` is the attacked statement, the evidence is Grok's objection.
  const conflictView = {
    ...view,
    participants: [{ id: "p3", provider: "xai", modelId: "grok-4", status: "active", voteWeight: 5 }],
    proposals: view.proposals.map((p) => ({
      ...p,
      revisions: p.revisions.map((r) => ({
        ...r,
        // Same conflicts, B in other case and punctuation – the old exact-match Set listed them twice.
        content: {
          ...r.content,
          requirementConflicts:
            p.id === "A"
              ? ["0 Minuten Ausfallzeit ist nicht erreichbar.", "Keine CDN erlaubt"]
              : ["0 minuten Ausfallzeit ist nicht erreichbar", "keine CDN erlaubt!"],
        },
      })),
    })),
    objections: [
      {
        id: "o3",
        proposalId: "B",
        claim: "Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen",
        evidence: "Caching hilft bei VOD, nicht bei Live-Transcoding.",
        status: "accepted",
        resolutionReason: "The objection is correct.",
        createdAt: new Date("2026-10-27T10:40:00Z"),
        raisedByParticipantId: "p3",
        category: "functional",
        severity: "critical",
        response: null,
        blocking: false,
      },
    ],
    decision: {
      outcome: "no_qualifying_solution",
      recommendedProposalId: null,
      gateVersion: 1,
      matrix: { requirementsConflict: true, formula: "", weights: {}, proposals: [], tiedProposalIds: [], majorityVoteWinnerId: null },
    },
  } as unknown as SessionView;

  it("renders each objection as an objection with its reasoning and decision, not as an accepted statement", () => {
    const report = buildDecisionReport(conflictView);
    expect(report.objections[0]).toMatchObject({ raisedBy: "xai/grok-4", evidence: "Caching hilft bei VOD, nicht bei Live-Transcoding.", status: "accepted" });
    const markdown = reportToMarkdown(report);
    expect(markdown).not.toContain("Minority opinions");
    expect(markdown).toContain("## Objections (Minority Review)");
    expect(markdown).toContain(
      "- Objection by xai/grok-4 against Proposal B: Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen Reasoning: Caching hilft bei VOD, nicht bei Live-Transcoding. – objection accepted (The objection is correct.) [functional/critical]",
    );
    expect(markdown).not.toMatch(/\[accepted\]/);
  });

  it("lists a conflict named by several proposals once", () => {
    expect(buildDecisionReport(conflictView).requirementConflicts).toEqual(["0 Minuten Ausfallzeit ist nicht erreichbar.", "Keine CDN erlaubt"]);
  });
});

describe("decision report for outcomes the gate does not approve (#181, stage 1)", () => {
  const withDecision = (decision: Record<string, unknown>) => ({ ...view, decision }) as unknown as SessionView;

  it("needs_verification: neutral outcome text, marked not approvable in JSON, Markdown and therefore PDF/Word", () => {
    const report = buildDecisionReport(withDecision({ outcome: "needs_verification", recommendedProposalId: "B", gateVersion: 1, matrix: { proposals: [] } }));
    expect(report.outcomeText).toMatch(/^Needs verification/);
    expect(report.decisionFormat).toEqual({ gateVersion: 1, approvable: false, reason: report.outcomeText });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("**Not approvable:** this verdict cannot be approved or built.");
    expect(markdown).toContain("## Leading proposal (not approvable): Proposal B");
    expect(markdown).not.toContain("## Recommended solution");
  });

  it("an unknown outcome or a newer gate version is not approvable, and a newer matrix is not interpreted", () => {
    const unknown = buildDecisionReport(withDecision({ outcome: "qualified", recommendedProposalId: null, gateVersion: 1, matrix: { proposals: [] } }));
    expect(unknown.outcomeText).toMatch(/does not know/);
    expect(unknown.decisionFormat?.approvable).toBe(false);
    const newer = buildDecisionReport(withDecision({ outcome: "recommended", recommendedProposalId: "B", gateVersion: 3, matrix: { somethingNew: true } }));
    expect(newer.outcomeText).toMatch(/gate version 3/);
    expect(newer.evaluationMatrix).toBeNull();
    expect(reportToMarkdown(newer)).toContain("Leading proposal (not approvable)");
    const legacy = buildDecisionReport(withDecision({ outcome: "recommended", recommendedProposalId: "B", gateVersion: 1, matrix: null }));
    expect(legacy.decisionFormat).toEqual({ gateVersion: 1, approvable: true, reason: null });
    expect(legacy.outcomeText).toBe("A solution is recommended.");
    // Version 2 without the engine's gate result: nothing in it is trusted, also not in the report (#181, S1).
    const noGate = buildDecisionReport(withDecision({ outcome: "recommended", recommendedProposalId: "B", gateVersion: 2, matrix: { proposals: [] } }));
    expect(noGate.decisionFormat).toMatchObject({ gateVersion: 2, approvable: false });
    expect(noGate.outcomeText).toMatch(/no requirement gate result/);
  });
});

describe("readable evaluation matrix (#181 live test)", () => {
  it("names evaluators by model instead of participant id, and marks the majority vote as information only", () => {
    const formula = 'total = Σ vote-weighted mean_independent_score(criterion) × weight(criterion) / 100; weights {"security":25}; evaluator vote weights {"par_73548610ca7c4001a7c6d93366f1a4ab":5,"par_00000000000000000000000000000000":5}';
    const report = buildDecisionReport({
      ...view,
      participants: [{ id: "par_73548610ca7c4001a7c6d93366f1a4ab", provider: "anthropic", modelId: "claude-haiku-5-5" }],
      decision: { outcome: "needs_verification", recommendedProposalId: null, gateVersion: 1, matrix: { formula, weights: {}, proposals: [], tiedProposalIds: [], majorityVoteWinnerId: "A" } },
    } as unknown as SessionView);
    expect(report.evaluationMatrix!.formula).toContain('{"anthropic/claude-haiku-5-5":5,"par_00000000000000000000000000000000":5}');
    expect(reportToMarkdown(report)).toContain("Majority vote (for information only – it never overrides the requirement check): A");
  });
});
