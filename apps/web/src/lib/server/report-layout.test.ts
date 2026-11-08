import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { reportPdf } = await import("./report-documents");

/**
 * Layout fixtures of #268 (synthetic test data, not real runs): (A) 3 proposals × 6 requirements, (B) 6 proposals × 45
 * requirements with long German/English texts, (C) 2 models, limited review, unknown measurements, rejected approval.
 * Checked on the extracted PDF text: nothing cut off, page master on every page, no English labels in a German PDF.
 */
const LABELS = ["A", "B", "C", "D", "E", "F"];
const STATUSES = ["PASS", "FAIL", "UNKNOWN", "DISPUTED"] as const;
const longText = (i: number) =>
  i % 3 === 0
    ? `Die Anwendung muss bei ${i * 100} gleichzeitigen Nutzern innerhalb von 300 ms antworten und darf personenbezogene Daten nur verschlüsselt in der Schweiz speichern (Anforderung Nr. ${i}).`
    : i % 3 === 1
      ? `The service must keep working when one of the ${i} upstream providers is unavailable for up to fifteen minutes, without losing queued messages (requirement ${i}).`
      : `Kosten höchstens ${i * 10} € pro Monat inklusive Hosting, Backups und Überwachung.`;

function fixture(proposals: number, requirements: number, opts: { limited?: boolean } = {}) {
  const labels = LABELS.slice(0, proposals);
  return {
    project: `Layout ${proposals}×${requirements}`,
    outcomeText: "x",
    decisionFormat: { gateVersion: 2, approvable: !opts.limited, reason: null },
    requirementsConflict: false,
    recommendedSolution: opts.limited ? null : { label: "A", title: "Erster Vorschlag" },
    approvableProposals: opts.limited ? [] : ["A"],
    evaluationMatrix: {
      weights: { technicalQuality: 30, security: 25, maintainability: 20, operatingCost: 15, implementationSpeed: 10 },
      proposals: labels.map((label, i) => ({ label, total: 9 - i * 0.7, criterionMeans: { technicalQuality: 9 - i, security: 8 - i / 2 } })),
    },
    requirementMatrix: {
      requirements: Array.from({ length: requirements }, (_, i) => ({ id: `R${i + 1}`, text: longText(i + 1) })),
      proposals: labels.map((proposal, p) => ({
        proposal,
        cells: Array.from({ length: requirements }, (_, i) => ({ status: p === 0 && !opts.limited ? "PASS" : STATUSES[(i + p) % 4], met: 1, expected: 2 })),
      })),
    },
    objections: [],
    approvals: opts.limited ? [{ action: "reject", comment: "Zu riskant" }] : [],
  };
}

const status = (approvable: boolean) => ({
  title: approvable ? "Empfohlene Lösung" : "Vorläufiger Favorit – eingeschränkte Prüfung, nicht freigebbar",
  approvable,
  line: approvable ? "Wartet auf deine Entscheidung" : "Abgelehnt",
  cruxes: { title: "Entscheidende Streitpunkte", none: "Keine dokumentierte entscheidende Meinungsverschiedenheit.", items: [] },
  nextSteps: null,
});

async function render(report: ReturnType<typeof fixture>, approvable: boolean, level: "brief" | "full") {
  const started = performance.now();
  const audit = {
    checks: report.requirementMatrix.requirements.flatMap((r) =>
      report.requirementMatrix.proposals.map((p) => ({
        requirement: `${r.id} ${r.text}`,
        proposal: p.proposal,
        evaluator: "openai · gpt-5-mini",
        status: "PASS",
        allPartsMet: false,
        evidence: "Belegt durch den Lasttest im Vorschlag.",
        estimate: null,
        counted: true,
        invalidReason: null,
      })),
    ),
    usage: Array.from({ length: 60 }, (_, i) => ({
      model: `model-${i}`,
      phase: "twelve_minds_council",
      calls: 2,
      failed: 0,
      inputTokens: 1000,
      outputTokens: 200,
    })),
    versions: { brief: 1, requirements: 2, gate: 2 },
  };
  const bytes = await reportPdf(
    "# Abschlussbericht\n\nText.",
    { title: "Abschlussbericht", sessionId: "ses_layout", createdAt: new Date("2026-11-08T12:00:00Z") },
    report as never,
    {
      locale: "de",
      level,
      status: status(approvable) as never,
      verdictId: "dec_layout",
      generatedAt: new Date("2026-11-08T16:30:00Z"),
      audit: audit as never,
    },
  );
  const ms = performance.now() - started;
  const { extractText } = await import("unpdf");
  const pages = (await extractText(new Uint8Array(bytes), { mergePages: false })).text as string[];
  return { pages: pages.map((p) => p.replace(/\s+/g, " ")), bytes: bytes.length, ms };
}

describe("PDF layout fixtures (#268 part 3)", () => {
  it("A: 3 proposals × 6 requirements – the brief fits on two pages and names every requirement", async () => {
    const { pages, bytes, ms } = await render(fixture(3, 6), true, "brief");
    expect(pages.length).toBeLessThanOrEqual(2);
    for (let i = 1; i <= 6; i++) expect(pages.join(" ")).toContain(`R${i} `);
    console.info(`#268 fixture A brief: ${pages.length} pages, ${bytes} bytes, ${Math.round(ms)} ms`);
  });

  it("B: 6 proposals × 45 long requirements – nothing cut off, header repeated, page master on every page", async () => {
    const { pages, bytes, ms } = await render(fixture(6, 45), true, "full");
    const all = pages.join(" ");
    // Every requirement and its full text (wrapped, not shortened with "…").
    for (let i = 1; i <= 45; i++) expect(all).toContain(longText(i).slice(-40));
    // Narrow cells use symbols with a legend.
    expect(all).toContain("OK = erfüllt");
    // The matrix header repeats on its continuation page.
    expect(pages.filter((p) => p.includes("Anforderung A B C D E F")).length).toBeGreaterThan(1);
    // The usage table repeats its header after a page break.
    expect(pages.filter((p) => p.includes("Modell Phase")).length).toBeGreaterThan(1);
    // Page master: AI note and x / y on every page, document id from page 2.
    pages.forEach((p, i) => {
      expect(p).toContain("KI-Bewertung – keine unabhängige Faktenprüfung");
      expect(p).toContain(`${i + 1} / ${pages.length}`);
      if (i > 0) expect(p).toContain("Layout 6x45 · Sitzung ses_layout · Urteil dec_layout · erstellt 2026-11-08 16:30 UTC");
    });
    // German PDF: no English labels from the PDF itself, phase names as product names, statuses translated.
    for (const english of ["not approvable", "Proposal ", "not every part confirmed", " PASS", "twelve minds council"]) expect(all).not.toContain(english);
    expect(all).toContain("12 Minds Council");
    expect(all).toContain("nicht jeder Teil bestätigt");
    console.info(`#268 fixture B full: ${pages.length} pages, ${bytes} bytes, ${Math.round(ms)} ms`);
  });

  it("C: 2 models, limited review, unknown checks, rejected – no misleading title, decision in words", async () => {
    const { pages } = await render(fixture(2, 5, { limited: true }), false, "brief");
    const first = pages[0]!;
    expect(first.indexOf("Abgelehnt")).toBeLessThan(first.indexOf("Vorläufiger Favorit – eingeschränkte Prüfung, nicht freigebbar"));
    expect(first).not.toContain("Empfohlene Lösung");
    expect(pages.join(" ")).toContain("abgelehnt – Zu riskant");
    expect(pages.join(" ")).toContain("Keine dokumentierte entscheidende Meinungsverschiedenheit.");
  });
});
