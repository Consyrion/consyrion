import { describe, expect, it } from "vitest";
import { countLimits, describeMeasure, detectMeasure } from "./requirement-measure";
import { MEASUREMENT_CHECK_GATE_VERSION, requirementVerification } from "./requirement-testability";

describe("measurable requirements", () => {
  it.each([
    ["Der Go-live muss innerhalb von 4 Monaten mit einem Team von 2 Entwicklern erfolgen.", { direction: "max", value: 4, unit: "months" }],
    ["Go-live spätestens in 4 Monaten.", { direction: "max", value: 4, unit: "months" }],
    ["The MVP must ship within 10 weeks.", { direction: "max", value: 10, unit: "weeks" }],
    ["Die Betriebskosten dürfen 400 EUR pro Monat nicht überschreiten.", { direction: "max", value: 400, unit: "EUR/month" }],
    ["Betriebskosten max. 300 EUR/Monat.", { direction: "max", value: 300, unit: "EUR/month" }],
    ["Running costs must not exceed €1.200 per month.", { direction: "max", value: 1200, unit: "EUR/month" }],
    ["Die Verfügbarkeit muss mindestens 99,5 % pro Monat betragen.", { direction: "min", value: 99.5, unit: "%" }],
    ["Verfügbarkeit 99,9 % in den Sprechzeiten.", { direction: "min", value: 99.9, unit: "%" }],
    // Test cases from ChatGPT and Gemini (30.10.26)
    [
      "Die monatlichen Betriebskosten einschließlich Hosting, Datenbank und Backups dürfen 150 € nicht überschreiten.",
      { direction: "max", value: 150, unit: "EUR/month" },
    ],
    [
      "Ein produktiv nutzbarer Pilot für zehn Praxen muss innerhalb von zwölf Wochen nach Projektstart bereitstehen.",
      { direction: "max", value: 12, unit: "weeks" },
    ],
    ["Die Anwendung muss spätestens 16 Wochen nach Projektstart produktiv einsetzbar sein.", { direction: "max", value: 16, unit: "weeks" }],
    [
      "Die Anwendung muss eine monatliche Verfügbarkeit von mindestens 99,0 % erreichen, wobei geplante Wartungszeiten mitgezählt werden.",
      { direction: "min", value: 99, unit: "%" },
    ],
  ])("%s", (text, measure) => {
    expect(detectMeasure(text)).toEqual(measure);
  });

  it.each([
    "Patientendaten werden ausschließlich in Rechenzentren in Deutschland gespeichert.",
    "Alle Daten werden täglich verschlüsselt gesichert und mindestens 30 Tage aufbewahrt.",
    "Die Protokolle werden 10 Jahre unveränderbar aufbewahrt.",
    // Two limits in one sentence: not measured, checked as before.
    "Go-live in 4 Monaten und Betriebskosten höchstens 400 EUR pro Monat.",
    // A price without a limit word is not a limit.
    "Das SMS-Paket kostet 30 EUR pro Monat.",
    "Testabdeckung von 80 % ist erwünscht.",
    // Availability and cost in one sentence (Gemini case 3): compound, not measured.
    "Die zentrale Plattform muss eine Verfügbarkeit von mindestens 99,99 % im Monat garantieren und darf maximal 95 EUR pro Monat kosten.",
  ])("no measure: %s", (text) => {
    expect(detectMeasure(text)).toBeNull();
  });

  // #226 audit: numbers and limit words that were read wrongly or not at all.
  it.each([
    // English thousands: was 1 EUR.
    ["Running costs must not exceed 1,000 EUR per month.", { direction: "max", value: 1000, unit: "EUR/month" }],
    ["Running costs must not exceed EUR 12,500.50 per month.", { direction: "max", value: 12500.5, unit: "EUR/month" }],
    ["Die Betriebskosten dürfen 1.000 € pro Monat nicht überschreiten.", { direction: "max", value: 1000, unit: "EUR/month" }],
    ["Die Betriebskosten dürfen 1'000 € pro Monat nicht überschreiten.", { direction: "max", value: 1000, unit: "EUR/month" }],
    ["Go-live innerhalb von 1,5 Monaten.", { direction: "max", value: 1.5, unit: "months" }],
    // Strict limits exclude the value itself.
    ["Die Betriebskosten müssen unter 150 € pro Monat liegen.", { direction: "max", value: 150, unit: "EUR/month", strict: true }],
    ["Running costs must be less than 150 EUR per month.", { direction: "max", value: 150, unit: "EUR/month", strict: true }],
    ["Running costs must stay < 150 EUR per month.", { direction: "max", value: 150, unit: "EUR/month", strict: true }],
    ["Go-live in weniger als 4 Monaten.", { direction: "max", value: 4, unit: "months", strict: true }],
    ["Die Verfügbarkeit muss über 99,9 % liegen.", { direction: "min", value: 99.9, unit: "%", strict: true }],
    ["Availability must be more than 99.9 %.", { direction: "min", value: 99.9, unit: "%", strict: true }],
    // Inclusive: negated or "at most / at least", and a strict word that is not before the number.
    ["Die Betriebskosten dürfen nicht über 150 € pro Monat liegen.", { direction: "max", value: 150, unit: "EUR/month" }],
    ["Running costs must be no more than 150 EUR per month.", { direction: "max", value: 150, unit: "EUR/month" }],
    ["Availability must be at least 99.95%.", { direction: "min", value: 99.95, unit: "%" }],
    ["Go-live innerhalb von 4 Monaten unter Einhaltung der Datenschutzvorgaben.", { direction: "max", value: 4, unit: "months" }],
  ])("#226: %s", (text, measure) => {
    expect(detectMeasure(text)).toEqual(measure);
  });

  it("#226: a sentence with several limits is not measured, and says how many it names", () => {
    const text = "Go-live within 4 months and costs at most 300 EUR per month.";
    expect(detectMeasure(text)).toBeNull();
    expect(countLimits(text)).toBe(2);
    expect(countLimits("Patientendaten bleiben in Deutschland.")).toBe(0);
    // "99,950 %" is not a percentage (> 100) – nothing is measured rather than a wrong number.
    expect(detectMeasure("Availability must be at least 99,950 %.")).toBeNull();
  });

  it("describes a measure", () => {
    expect(describeMeasure({ direction: "max", value: 150, unit: "EUR/month", strict: true })).toBe("below 150 EUR per month");
    expect(describeMeasure({ direction: "min", value: 99.9, unit: "%", strict: true })).toBe("above 99.9 %");
    expect(describeMeasure({ direction: "max", value: 4, unit: "months" })).toBe("at most 4 months");
    expect(describeMeasure({ direction: "min", value: 99.5, unit: "%" })).toBe("at least 99.5 %");
    expect(describeMeasure({ direction: "max", value: 400, unit: "EUR/month" })).toBe("at most 400 EUR per month");
  });
});

/**
 * #226 test matrix: every relation (≤ < ≥ >) in German and English, symbol and word forms, with the number formats
 * users type. "strict" must never be dropped (a strict limit read as inclusive lets an estimate exactly at it pass).
 */
describe("#226 relation × language × number format", () => {
  const max = (value: number, unit: "months" | "weeks" | "EUR/month", strict = false) => ({
    direction: "max",
    value,
    unit,
    ...(strict ? { strict: true } : {}),
  });
  const min = (value: number, strict = false) => ({ direction: "min", value, unit: "%", ...(strict ? { strict: true } : {}) });
  it.each([
    // ≤ (inclusive maximum)
    ["Betriebskosten höchstens 140 € pro Monat", max(140, "EUR/month")],
    ["Running costs at most 140 EUR per month", max(140, "EUR/month")],
    ["Kosten max. 1.000 € pro Monat", max(1000, "EUR/month")],
    ["Kosten max. 1'000 € pro Monat", max(1000, "EUR/month")],
    ["Kosten max. 1 000 € pro Monat", max(1000, "EUR/month")],
    ["Kosten max. 1 000 € pro Monat", max(1000, "EUR/month")],
    ["Coûts max. 1 000 € pro Monat", max(1000, "EUR/month")],
    ["costs must not exceed €1,000/month", max(1000, "EUR/month")],
    ["Kosten dürfen 150 € pro Monat nicht übersteigen", max(150, "EUR/month")],
    ["costs of at most 0.5 EUR per month", max(0.5, "EUR/month")],
    ["Go-live within 12 weeks", max(12, "weeks")],
    ["Go-live innerhalb von zwölf Wochen", max(12, "weeks")],
    ["no more than 4 months", max(4, "months")],
    ["not more than 4 months", max(4, "months")],
    ["costs of not more than 300 EUR per month", max(300, "EUR/month")],
    ["Die Kosten dürfen nicht über 150 € pro Monat liegen", max(150, "EUR/month")],
    // < (strict maximum)
    ["Kosten unter 1.000,50 € im Monat", max(1000.5, "EUR/month", true)],
    ["costs below €1,000/month", max(1000, "EUR/month", true)],
    ["costs less than 150 EUR per month", max(150, "EUR/month", true)],
    ["Go-live in weniger als 12 Wochen", max(12, "weeks", true)],
    ["Go-live in less than 3 months", max(3, "months", true)],
    // ≥ (inclusive minimum)
    ["Verfügbarkeit mindestens 99,95 %", min(99.95)],
    ["availability of at least 99.95%", min(99.95)],
    ["uptime ≥ 99.9 %", min(99.9)],
    ["Verfügbarkeit nicht unter 99,9 %", min(99.9)],
    ["Verfügbarkeit ab 99,9 %", min(99.9)],
    // > (strict minimum)
    ["Verfügbarkeit über 99,9 %", min(99.9, true)],
    ["availability of more than 99.9 %", min(99.9, true)],
    ["uptime > 99.9 %", min(99.9, true)],
  ])("%s", (text, measure) => {
    expect(detectMeasure(text)).toEqual(measure);
    expect(countLimits(text)).toBe(1);
  });

  it.each([
    // #249 variant A: a percentile of a performance limit is measured on the running implementation, never estimated.
    ["mindestens 95 % der Seitenaufrufe in unter 300 ms", 1],
    ["at least 95 % of page loads within 300 ms", 1],
    ["p95-Latenz unter 200 ms", 1],
    ["Antwortzeit höchstens 2 Sekunden", 1],
    // An availability next to a performance limit: two limits, split them.
    ["Verfügbarkeit 99,9 % und Antwortzeit unter 200 ms", 2],
    ["Go-live within 3 months and response time below 1 s", 2],
    // Compound limits are never checked as one number.
    ["Verfügbarkeit 99,9 % und Kosten höchstens 150 € pro Monat", 2],
    // Not measured on purpose (judged as plain requirements, no wrong number): days, ranges, one-off budgets, GB, error rates.
    ["fertig in 90 Tagen", 0],
    ["innerhalb von 6 bis 8 Wochen", 0],
    ["Budget: 50.000 € einmalig", 0],
    ["Speicher unter 2 GB", 0],
    ["Fehlerrate unter 1 %", 0],
  ])("no single estimated limit: %s", (text, limits) => {
    expect(detectMeasure(text)).toBeNull();
    expect(countLimits(text)).toBe(limits);
  });
});

describe("#226 / #249 variant A: one rule for intake and engine", () => {
  it("a percentile of a performance limit has no estimated measure and is a measurement check", () => {
    const text = "mindestens 95 % der Seitenaufrufe unter 300 ms";
    expect(detectMeasure(text)).toBeNull();
    expect(requirementVerification({ text }, MEASUREMENT_CHECK_GATE_VERSION)).toBe("measurement");
  });

  it("an availability limit keeps its measure and is judged from the proposal", () => {
    const text = "Verfügbarkeit mindestens 99,5 %";
    expect(detectMeasure(text)).toEqual({ direction: "min", value: 99.5, unit: "%" });
    expect(requirementVerification({ text }, MEASUREMENT_CHECK_GATE_VERSION)).toBeNull();
  });
});
