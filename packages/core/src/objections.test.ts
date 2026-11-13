import { describe, expect, it } from "vitest";
import { dedupeSamePoint, dedupeStatements, describeObjection, objectionStatusText, sameObjectionPoint } from "./objections";

describe("describeObjection (#169)", () => {
  it("names the objection, its author, the proposal, the reasoning and the decision", () => {
    // Shape of council ses_4df40e35…: Grok quoted the attacked statement in `claim`; the evidence holds the objection.
    const line = describeObjection({
      proposal: "B",
      raisedBy: "xai/grok-4",
      claim: "Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen",
      evidence: "Caching hilft bei VOD,\n nicht bei Live-Transcoding.",
      status: "accepted",
      resolution: "The objection is correct.",
    });
    expect(line).toBe(
      "Objection by xai/grok-4 against Proposal B: Mit Caching-Mechanismen kann der Raspberry Pi 5 10.000 Zuschauer in 4K bedienen" +
        " Reasoning: Caching hilft bei VOD, nicht bei Live-Transcoding. – objection accepted (The objection is correct.)",
    );
    expect(line).not.toMatch(/^accepted/);
  });

  it("marks blocking objections and leaves out empty parts", () => {
    expect(describeObjection({ proposal: "A", raisedBy: "m1", claim: "No auth", status: "unresolved", blocking: true })).toBe(
      "Objection by m1 against Proposal A: No auth – objection unresolved – blocks approval",
    );
    expect(objectionStatusText("refuted")).toBe("objection refuted");
  });
});

describe("dedupeStatements (#173)", () => {
  it("removes exact and normalised duplicates and keeps the first wording", () => {
    expect(
      dedupeStatements([
        "0 Minuten Ausfallzeit ist nicht erreichbar.",
        "0 minuten Ausfallzeit ist nicht erreichbar",
        "  0 Minuten  Ausfallzeit ist nicht erreichbar! ",
        "Keine CDN erlaubt",
        "Keine CDN erlaubt",
        "Ein CDN ist ausgeschlossen",
        "",
      ]),
    ).toEqual(["0 Minuten Ausfallzeit ist nicht erreichbar.", "Keine CDN erlaubt", "Ein CDN ist ausgeschlossen"]);
  });
});

describe("same objection point within one model (night test 07.11.26)", () => {
  it("treats a slightly reworded repeat as the same point", () => {
    expect(
      sameObjectionPoint(
        "Die gleichzeitige Nennung von SERIALIZABLE, Advisory Locks und pessimistischen Locks ist unscharf, und ohne Retry-Strategie drohen Serialisierungsfehler, Deadlocks und Retry-Stürme unter Last.",
        "Die gleichzeitige Nennung von SERIALIZABLE, Advisory Locks und pessimistischen Locks ist unscharf und kann Retry-Stürme und Durchsatzverlust verursachen.",
      ),
    ).toBe(true);
    expect(sameObjectionPoint("Same claim, same words.", "same claim same words")).toBe(true);
  });

  it("keeps different points apart, also when they share a topic", () => {
    expect(
      sameObjectionPoint(
        "Die Kostenschätzung von 900–1.700 EUR überschreitet in der Spanne die Grenze von 1.500 EUR, sodass R6 nicht robust nachgewiesen ist.",
        "Die Mandantenisolation über SET LOCAL und die Audit-Hash-Kette in derselben DB sind für Worker, Outbox-Relay und privilegierte Insider unterbestimmt.",
      ),
    ).toBe(false);
    expect(
      sameObjectionPoint(
        "Das Audit-Konzept protokolliert keine Lesezugriffe auf Patientendaten und schützt nicht gegen privilegierte Datenbankzugriffe.",
        "Die Worker-Isolation und PVS-Geheimnisse pro Praxis sind unterdefiniert, wodurch Cross-Tenant-Lecks in Hintergrundprozessen möglich bleiben.",
      ),
    ).toBe(false);
    // Conservative on purpose: a strong rewording (compounds, inflection) stays separate – deciding that needs a model.
    expect(
      sameObjectionPoint(
        "Die synchrone PVS-Bestätigung vor Buchungszusage koppelt die Buchungsverfügbarkeit an die PVS und stellt 99,9 % (R3) in Frage.",
        "Die Forderung nach synchroner PVS-Bestätigung vor finaler Buchungszusage koppelt die Verfügbarkeit der Buchung an die PVS-Verfügbarkeit und widerspricht so R3.",
      ),
    ).toBe(false);
    // Too short to judge by words: only identical statements count.
    expect(sameObjectionPoint("Costs too high.", "Costs are too high for R6.")).toBe(false);
  });
});

describe("dedupeSamePoint", () => {
  const wal = "Eine reine Dateikopie der SQLite-Datenbank im WAL-Modus kann ein inkonsistentes Backup erzeugen.";
  const walAgain = "Die Dateikopie der SQLite-Datenbank im WAL-Modus kann ein inkonsistentes Backup erzeugen, solange kein Checkpoint läuft.";
  const rights = "Die Zugriffsrechte auf die SQLite- und Backup-Dateien sind nicht festgelegt und erlauben fremden Lesezugriff.";

  it("keeps one entry per point: the best-ranked wording, at the place of the first mention", () => {
    const entries = [
      { text: wal, rank: 3 },
      { text: rights, rank: 3 },
      { text: walAgain, rank: 0 },
      { text: wal, rank: 1 },
    ];
    expect(
      dedupeSamePoint(
        entries,
        (e) => e.text,
        (e) => e.rank,
      ),
    ).toEqual([
      { text: walAgain, rank: 0 },
      { text: rights, rank: 3 },
    ]);
  });

  it("keeps the first wording on equal rank, leaves different points alone and drops empty statements", () => {
    expect(dedupeSamePoint([wal, " ", rights, walAgain], (e) => e)).toEqual([wal, rights]);
  });
});
