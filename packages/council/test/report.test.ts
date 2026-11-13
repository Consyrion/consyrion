import { describe, expect, it } from "vitest";
import { buildDecisionReport, reportLocale, reportToMarkdown, reportTranslator, type SessionView } from "../src";

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
    const newer = buildDecisionReport(withDecision({ outcome: "recommended", recommendedProposalId: "B", gateVersion: 4, matrix: { somethingNew: true } }));
    expect(newer.outcomeText).toMatch(/gate version 4/);
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
    const formula =
      'total = Σ vote-weighted mean_independent_score(criterion) × weight(criterion) / 100; weights {"security":25}; evaluator vote weights {"par_73548610ca7c4001a7c6d93366f1a4ab":5,"par_00000000000000000000000000000000":5}';
    const report = buildDecisionReport({
      ...view,
      participants: [{ id: "par_73548610ca7c4001a7c6d93366f1a4ab", provider: "anthropic", modelId: "claude-haiku-5-5" }],
      decision: {
        outcome: "needs_verification",
        recommendedProposalId: null,
        gateVersion: 1,
        matrix: { formula, weights: {}, proposals: [], tiedProposalIds: [], majorityVoteWinnerId: "A" },
      },
    } as unknown as SessionView);
    expect(report.evaluationMatrix!.formula).toContain('{"anthropic/claude-haiku-5-5":5,"par_00000000000000000000000000000000":5}');
    expect(reportToMarkdown(report)).toContain("Majority vote (for information only – it never overrides the requirement check): A");
    // Confluence test 09.11.26: the formula reads as a sentence with criterion names, also in German.
    expect(reportToMarkdown(report)).not.toContain("mean_independent_score");
    expect(reportToMarkdown(report, "de")).toContain("Gewichte: Sicherheit 25 %; Stimmgewichte: anthropic/claude-haiku-5-5 5/10");
  });
});

describe("decision report in the interface language (#322)", () => {
  it("translates the fixed wording and keeps model output as written", () => {
    const report = buildDecisionReport(view);
    const de = reportToMarkdown(report, "de");
    expect(de).toContain("# Abschlussbericht – Buchung");
    expect(de).toContain("**Architekturwechsel:** Fassung v2 ersetzt die Lösung von v1; sie ähnelt Vorschlag A.");
    expect(de).toContain("### Nach der Überarbeitung nicht mehr zutreffend");
    expect(de).toContain("Verbrauchte Tokens: 0 von 400'000");
    expect(de).toContain("Django-PWA mit PostgreSQL-Exclusion-Constraint und Warm-Standby");
    expect(de).not.toContain("## Remaining risks");
    // Telegram live test 08.11.26: the report says what each proposal is, right after the outcome.
    expect(de).toContain("### Die Vorschläge");
    expect(de).toMatch(/\*\*Vorschlag A\*\* – /);
    expect(de).not.toMatch(/evaluators \(model judgement\)|could not confirm it/);
    // Night test R2-01 (08.11.26): no raw status values in the German report.
    expect(de).not.toMatch(/Status: [a-z]+_[a-z]+/);
    expect(de).toMatch(
      /Status: (?:wartet auf Freigabe|wartet auf deine Prüfung · kein freigebbarer Vorschlag|läuft|freigegeben|abgelehnt|Änderungen angefordert|in der Warteschlange|abgebrochen|fehlgeschlagen)/,
    );
    // English stays exactly as before.
    expect(reportToMarkdown(report)).toBe(reportToMarkdown(report, "en"));
  });

  it("falls back to English for languages without a report translation; Chinese has one since #268", () => {
    expect(reportLocale("zh")).toBe("zh");
    expect(reportLocale("ja")).toBe("en");
    expect(reportLocale("fr")).toBe("fr");
    expect(reportTranslator("es")("Proposal {label}", { label: "B" })).toBe("Propuesta B");
    expect(reportTranslator("fr")("A text without translation")).toBe("A text without translation");
  });
});

describe("remaining risks name every point once (11.11.26)", () => {
  it("merges the consensus risk, the proposal's own risk and objections about the same point into one line", () => {
    const wal = "Eine reine Dateikopie der SQLite-Datenbank im WAL-Modus kann ein inkonsistentes Backup erzeugen";
    const failover = view.objections[view.objections.length - 1]!;
    const withRisks = structuredClone(view) as SessionView;
    const b = withRisks.proposals.find((p) => p.id === "B")!;
    (b.revisions[b.revisions.length - 1]!.content as { risks: unknown[] }).risks = [
      { risk: `${wal}, solange kein Checkpoint läuft`, severity: "medium", mitigation: "sqlite3 .backup verwenden" },
    ];
    (withRisks as { consensus: unknown }).consensus = {
      status: "partial_consensus",
      basedOn: [],
      agreements: [],
      disagreements: [],
      outstandingRisks: [`${wal}.`, failover.claim],
    };
    withRisks.objections.push(
      { ...failover, id: "o3", claim: `${wal}.`, status: "accepted" },
      { ...failover, id: "o4", claim: `${wal} und ist damit unbrauchbar.`, raisedByParticipantId: "p2" },
    );
    const report = buildDecisionReport(withRisks);
    expect(report.remainingRisks).toEqual([
      `${wal}, solange kein Checkpoint läuft (medium; mitigation: sqlite3 .backup verwenden)`,
      `${failover.claim} (unresolved objection)`,
    ]);
    // The objection list itself keeps every voice.
    expect(report.objections.filter((o) => o.claim.startsWith(wal))).toHaveLength(2);
  });
});

describe("report wording found in a German report (11.11.26)", () => {
  it("words the reason an author did not answer in the report language", () => {
    const undefended = structuredClone(view) as SessionView;
    Object.assign(undefended.objections[undefended.objections.length - 1]!, { response: null, undefendedReason: "the author's answer was unusable (schema)" });
    const german = reportToMarkdown(buildDecisionReport(undefended), "de");
    expect(german).toContain("NICHT VERTEIDIGT – die Antwort des Autors war nicht verwertbar (nicht im erwarteten Format)");
    expect(german).not.toContain("the author's answer");
    expect(reportToMarkdown(buildDecisionReport(undefended))).toContain("NOT DEFENDED – the author's answer was unusable (schema)");
  });

  it("says which revision a still-open objection was written about when the recommendation has moved on", () => {
    const older = structuredClone(view) as SessionView;
    const failover = older.objections[older.objections.length - 1]!;
    older.objections.push({ ...failover, id: "o5", claim: "Die PWA braucht ein Offline-Konzept", createdAt: new Date("2026-10-27T10:10:00Z") });
    const report = buildDecisionReport(older);
    expect(report.remainingRisks).toContain("Die PWA braucht ein Offline-Konzept (unresolved objection; raised against v1, the recommendation is v2)");
    expect(report.remainingRisks).toContain("Der Warm-Standby braucht einen getesteten Failover (unresolved objection)");
    expect(reportToMarkdown(report, "de")).toContain("Die PWA braucht ein Offline-Konzept (Einwand ungeklärt; erhoben gegen Fassung v1, empfohlen wird v2)");
  });
});

describe("answer first, risks by source (owner decisions 11.11.26)", () => {
  const build = () => {
    const v = structuredClone(view) as SessionView;
    const b = v.proposals.find((p) => p.id === "B")!;
    Object.assign(b.revisions[b.revisions.length - 1]!.content as object, {
      recommendations: ["Zuerst den Failover proben", "Danach die Buchung freischalten"],
      risks: [{ risk: "Der Standby-Server kann beim Umschalten Buchungen verlieren", severity: "high", mitigation: "synchrone Replikation" }],
    });
    (v as { consensus: unknown }).consensus = {
      status: "partial_consensus",
      basedOn: [],
      agreements: [],
      disagreements: [],
      outstandingRisks: ["Die Betriebskosten zweier Server sind nicht beziffert"],
    };
    v.objections.push({
      ...v.objections[v.objections.length - 1]!,
      id: "o6",
      claim: "Die PWA braucht ein Offline-Konzept",
      createdAt: new Date("2026-10-27T10:10:00Z"),
    });
    return buildDecisionReport(v);
  };

  it("puts the recommended proposal's summary and steps right under the outcome and does not repeat the steps at the end", async () => {
    const de = reportToMarkdown(build(), "de");
    if (process.env.PEEK) (await import("node:fs")).writeFileSync(process.env.PEEK, de);
    const answer = de.indexOf("### Die Antwort in Kürze");
    expect(answer).toBeGreaterThan(de.indexOf("## Ergebnis"));
    expect(answer).toBeLessThan(de.indexOf("## Verbleibende Risiken"));
    expect(answer).toBeLessThan(de.indexOf("### Die Vorschläge"));
    expect(de.slice(answer, answer + 400)).toContain("**Vorschlag B – Django-PWA mit PostgreSQL-Exclusion-Constraint und Warm-Standby**");
    expect(de.split("- Zuerst den Failover proben")).toHaveLength(2);
    expect(de).toMatch(/## Nächste Schritte\n- (?!Zuerst)/);
  });

  it("QA 12.11.26: states open high objections against the recommendation right after the answer, not only deep in the matrix", () => {
    const report = build();
    const recommended = report.recommendedSolution!.label;
    const open = report.objections.filter(
      (o) =>
        o.proposal === recommended && (o.severity === "high" || o.severity === "critical") && ["open", "accepted", "unresolved"].includes(o.status) && !o.moot,
    ).length;
    const de = reportToMarkdown(report, "de");
    if (open) {
      const caution = de.indexOf("> **Mit Vorbehalt:**");
      expect(caution).toBeGreaterThan(de.indexOf("### Die Antwort in Kürze"));
      expect(caution).toBeLessThan(de.indexOf("### Die Vorschläge"));
    } else expect(de).not.toContain("Mit Vorbehalt");
    // Same words as the screen: "Zuversicht", not a second term.
    expect(de).not.toContain("Geringe Verlässlichkeit");
  });

  it("prints no answer block without a recommended proposal", () => {
    const v = structuredClone(view) as SessionView;
    (v as { decision: unknown }).decision = { outcome: "no_qualifying_solution", recommendedProposalId: null, matrix: null, gateVersion: 1 };
    expect(reportToMarkdown(buildDecisionReport(v), "de")).not.toContain("Antwort in Kürze");
  });

  it("lists the remaining risks by who named them", () => {
    const report = build();
    expect(report.remainingRiskGroups).toEqual({
      consensus: ["Die Betriebskosten zweier Server sind nicht beziffert"],
      proposal: ["Der Standby-Server kann beim Umschalten Buchungen verlieren (high; mitigation: synchrone Replikation)"],
      objections: [
        "Der Warm-Standby braucht einen getesteten Failover (unresolved objection)",
        "Die PWA braucht ein Offline-Konzept (unresolved objection; raised against v1, the recommendation is v2)",
      ],
    });
    const de = reportToMarkdown(report, "de");
    const risks = de.slice(de.indexOf("## Verbleibende Risiken"));
    expect(risks.indexOf("**Aus dem Konsens**")).toBeLessThan(risks.indexOf("**Risiken laut Vorschlag**"));
    expect(risks.indexOf("**Risiken laut Vorschlag**")).toBeLessThan(risks.indexOf("**Offene Einwände**"));
    // A report stored before the groups existed keeps the flat list.
    const old = { ...report, remainingRiskGroups: undefined } as unknown as typeof report;
    expect(reportToMarkdown(old, "de")).not.toContain("**Aus dem Konsens**");
  });

  it("notes on an objection that it was written about an earlier revision", () => {
    const de = reportToMarkdown(build(), "de");
    expect(de).toMatch(/Die PWA braucht ein Offline-Konzept[^\n]*– erhoben gegen Fassung v1; der Vorschlag steht jetzt bei v2/);
    expect(de).not.toMatch(/Der Warm-Standby braucht einen getesteten Failover –[^\n]*erhoben gegen Fassung/);
  });
});
