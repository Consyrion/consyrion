import { requirementCheckability } from "@consyrion/core";
import {
  addDocument,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  proposeRequirementList,
  resolveActor,
  schema,
  setSubscriptionPlan,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * #245 regression corpus for the requirement intake: real briefs of earlier councils with the requirements their
 * authors wrote as binding. Two numbers per case, measured on what the intake proposes as items:
 * - recall: every binding requirement is proposed (never improved by dropping real requirements – external review);
 * - precision: proposed items that are real requirements. Target over the corpus: proposed : real ≤ 2 : 1
 *   (31.10.26 the self-improvement project was 21 : 6).
 * Matching uses a distinctive fragment of each requirement, so wording changes elsewhere do not break the corpus.
 */

interface Case {
  name: string;
  brief: { idea: string; goal?: string; requirements?: string };
  document?: { name: string; content: string };
  /** A fragment of every requirement the author wrote as binding. */
  binding: string[];
}

const CORPUS: Case[] = [
  {
    name: "Praxis-SaaS (QA-Live 27.10 A)",
    brief: {
      idea: "Eine Praxis-SaaS für Termine, Dokumentation und Abrechnung einer Arztpraxis mit drei Standorten.",
      goal: "Go-live spätestens in 4 Monaten.",
      requirements:
        "Gesundheitsdaten dürfen nur in Deutschland gespeichert werden, keine Verarbeitung außerhalb der EU. Verschlüsselung at rest und in transit. " +
        "Ein revisionssicherer Audit-Trail wird 10 Jahre aufbewahrt. Die Praxis muss bis zu 4 Stunden offline arbeiten können, ohne Datenverlust und ohne Doppelbuchungen. " +
        "Verfügbarkeit 99,9 % in den Sprechzeiten. Betriebskosten max. 300 EUR/Monat. Das Team besteht aus 3 Entwicklern. Migration aus 120 Access-Dateien ohne Praxisstillstand.",
    },
    binding: [
      "nur in Deutschland",
      "Verschlüsselung at rest",
      "Audit-Trail wird 10 Jahre",
      "4 Stunden offline",
      "99,9 %",
      "300 EUR/Monat",
      "3 Entwicklern",
      "120 Access-Dateien",
      "spätestens in 4 Monaten",
    ],
  },
  {
    name: "OnJam (31.10., R5 only measurable after implementation)",
    brief: {
      idea: "OnJam: Musiker proben gemeinsam über das Internet.",
      goal: "Eine Architektur für die erste Version.",
      requirements: [
        "Die Lösung muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen.",
        "Die Ende-zu-Ende-Latenz muss unter 30 ms liegen.",
        "Server stehen ausschließlich in der Schweiz.",
        "Betriebskosten höchstens 500 CHF pro Monat.",
      ].join("\n"),
    },
    binding: ["rhythmisch stabiles Zusammenspiel", "unter 30 ms", "ausschließlich in der Schweiz", "höchstens 500 CHF"],
  },
  {
    name: "Bestellportal (night test R2-03)",
    brief: {
      idea: "Ein internes Bestellportal verarbeitet jährlich rund 12.000 Bestellungen für 80 Mitarbeiter. Das alte System benötigte bei einer früheren Migration 20 Tage; diese historische Angabe ist nur Hintergrundinformation.",
      goal: "Vergleiche die Lösungen anhand der ausdrücklich aufgeführten Pflichtanforderungen.",
      requirements:
        "Sämtliche gespeicherten Bestelldaten müssen ausschließlich innerhalb der EU gespeichert werden.\nDie vollständigen monatlichen Betriebskosten müssen strikt unter 400 CHF liegen.\nEin CSV-Export muss mindestens Bestell-ID und Bestelldatum enthalten.\nMindestens 10 Anfragen müssen gleichzeitig verarbeitet werden können.",
    },
    binding: ["innerhalb der EU gespeichert", "unter 400 CHF", "CSV-Export", "10 Anfragen"],
  },
  {
    name: "Self-improvement run log (30.10., 21 candidates, 6 real then)",
    brief: {
      idea: "CONSYRION verbessert sich selbst.",
      requirements: "BYOK bleibt: keine Betreiber-Keys.\nUmsetzbar im bestehenden Stack in kleinen Schritten.",
    },
    document: {
      name: "laeufe.md",
      content: [
        "# Läufe Oktober",
        "",
        "| Lauf | Tokens | Ergebnis |",
        "|---|---|---|",
        "| OnJam 1 | 253k | needs verification |",
        "| OnJam 2 | 741k | needs verification |",
        "",
        "Von 11 Councils endeten 3 mit Empfehlung.",
        "Repo-Kontext verdreifacht die Tokens (253k → 741k).",
        "In fast jedem Lauf 1–4 abgeschnittene Antworten, nicht nur bei DeepSeek.",
        "",
        "## Vorgaben",
        "- Prompts und Antworten dürfen nie in Logs landen.",
        "- Ein Council darf höchstens 900k Tokens verbrauchen.",
        "",
        "## SLA",
        "Ping Schweiz → jam-01 15–18 ms.",
        "Verfügbarkeit ≥ 99,95 %.",
        "Antwortzeit unter 200 ms.",
        "Protokolle sind 10 Jahre aufzubewahren.",
      ].join("\n"),
    },
    binding: ["BYOK bleibt", "bestehenden Stack", "nie in Logs", "900k Tokens", "99,95 %", "unter 200 ms", "10 Jahre aufzubewahren"],
  },
];

let handle: DatabaseHandle;
let actor: ActorContext;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u_corpus", name: "Corpus", email: "corpus@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u_corpus", "Corpus");
  actor = await resolveActor(handle.db, "u_corpus", org.id);
  await setSubscriptionPlan(handle.db, "u_corpus", org.id, "business");
});

afterAll(async () => {
  await handle.close();
});

const measured = new Map<string, Promise<{ items: string[]; missing: string[]; proposed: number; real: number }>>();
/** Each case is created once and measured once, however many tests read it. */
function measure(c: Case) {
  if (!measured.has(c.name)) measured.set(c.name, measureOnce(c));
  return measured.get(c.name)!;
}

async function measureOnce(c: Case) {
  const id = (await createProject(handle.db, actor, { name: c.name, type: "architecture", brief: c.brief })).id;
  if (c.document)
    await addDocument(handle.db, actor, id, { name: c.document.name, mimeType: "text/markdown", bytes: new TextEncoder().encode(c.document.content) });
  const proposal = await proposeRequirementList(handle.db, actor, id);
  const items = proposal.items.map((i) => i.text);
  const missing = c.binding.filter((fragment) => !items.some((t) => t.includes(fragment)));
  const real = items.filter((t) => c.binding.some((fragment) => t.includes(fragment)));
  return { items, missing, proposed: items.length, real: real.length };
}

describe("#245 requirement intake corpus", () => {
  it("recall: every requirement the author wrote as binding is proposed – in every case", async () => {
    for (const c of CORPUS) expect((await measure(c)).missing, c.name).toEqual([]);
  });

  it("precision: over the corpus at most two proposed items per real requirement (31.10.26: 21 : 6)", async () => {
    let proposed = 0;
    let real = 0;
    for (const c of CORPUS) {
      const m = await measure(c);
      proposed += m.proposed;
      real += m.real;
      // No single case may fall back to the old 3.5 : 1.
      expect(m.proposed, c.name).toBeLessThanOrEqual(m.real * 2);
    }
    // Shown in the test output so a change of the rules makes the numbers visible (#245 measure).
    console.info(`[corpus #245] proposed ${proposed}, real ${real} (${(proposed / real).toFixed(2)} : 1)`);
    expect(proposed).toBeLessThanOrEqual(real * 2);
  });

  it("classifies OnJam R5 and the latency limit as measurable only after implementation, the other limits as checkable before the start", async () => {
    const { items } = await measure(CORPUS[1]!);
    const kind = (fragment: string) => requirementCheckability(items.find((t) => t.includes(fragment))!);
    expect(kind("rhythmisch stabiles Zusammenspiel")).toBe("after_implementation");
    // Owner decision 08.11.26 (#249, variant A): a limit in ms/s is proven only by measuring the running implementation.
    expect(kind("unter 30 ms")).toBe("after_implementation");
    expect(kind("ausschließlich in der Schweiz")).toBe("before");
    expect(requirementCheckability("Alle automatisierten Tests müssen grün sein.")).toBe("build");
  });
});
