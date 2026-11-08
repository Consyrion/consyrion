import { describe, expect, it } from "vitest";
import { needsBuildVerification, performanceLimit, requirementVerification } from "./requirement-testability";
import { buildConfirmedRequirements } from "./requirements";

describe("build checks (night test R4)", () => {
  it("detects requirements only the implementation can prove", () => {
    expect(
      needsBuildVerification(
        "Automatisierte Tests müssen diese Eigenschaften nachweisen, und .github/workflows/test.yml muss für den Draft-PR erfolgreich durchlaufen.",
      ),
    ).toBe(true);
    expect(needsBuildVerification("The GitHub Actions pipeline must be green for the pull request.")).toBe(true);
    expect(needsBuildVerification("Unit tests must cover the rename function.")).toBe(true);
    expect(needsBuildVerification("Eine unbekannte ID muss einen Fehler auslösen, ohne einen neuen Todo-Eintrag anzulegen.")).toBe(false);
    expect(needsBuildVerification("Monthly cost must not exceed 300 EUR.")).toBe(false);
  });

  it("marks such items when the list is confirmed", () => {
    const { items } = buildConfirmedRequirements([], {
      items: [{ text: "rename(id, title) muss den Titel ändern." }, { text: "Automatisierte Tests mit node --test müssen grün sein." }],
      excluded: [],
    } as never);
    expect(items.map((i) => i.verification ?? null)).toEqual([null, "build"]);
  });
});

describe("requirementVerification (#249 part 2)", () => {
  const onjam = "Die Lösung muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen.";
  it("gate version 3 checks a requirement only a measurement can prove as a measurement check – also on older lists", () => {
    expect(requirementVerification({ text: onjam }, 3)).toBe("measurement");
    expect(requirementVerification({ text: onjam, verification: "measurement" }, 3)).toBe("measurement");
    expect(requirementVerification({ text: "Data must stay in Germany." }, 3)).toBeNull();
  });
  it("gate version 2 never sees the measurement mark; build checks stay build checks", () => {
    expect(requirementVerification({ text: onjam, verification: "measurement" }, 2)).toBeNull();
    expect(requirementVerification({ text: "Automated tests must pass in CI.", verification: "build" }, 2)).toBe("build");
    expect(requirementVerification({ text: "Automated tests must pass in CI.", verification: "build" }, 3)).toBe("build");
  });
});

describe("performance limits are measurement checks (owner decision 08.11.26, variant A)", () => {
  it("a limit in ms or s is a measurement check from gate version 3 – however confident the estimates", () => {
    for (const text of [
      "95 % of page loads must complete within 300 ms inside the company network.",
      "API responses must take less than 200 ms.",
      "Die Antwortzeit muss unter 2 s liegen.",
      "Die Seite muss in 3 Sekunden laden.",
      "Failover within 30 seconds.",
    ]) {
      expect(performanceLimit(text), text).toBe(true);
      expect(requirementVerification({ text }, 3), text).toBe("measurement");
      expect(requirementVerification({ text }, 2), text).toBeNull();
    }
  });
  it("cost, availability, durations and plain counts stay what they are", () => {
    for (const text of [
      "Hosting costs must be at most 200 EUR per month.",
      "Die Verfügbarkeit muss mindestens 99,5 % betragen.",
      "Go-live within 4 months.",
      "Die Wiederherstellung muss innerhalb von 4 Stunden möglich sein.",
      "Die Lösung muss 2 Standorte verbinden.",
      "Audit logs must be kept for 12 months.",
    ]) {
      expect(performanceLimit(text), text).toBe(false);
      expect(requirementVerification({ text }, 3), text).toBeNull();
    }
  });
});
