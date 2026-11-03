import { describe, expect, it } from "vitest";
import { countLimits, describeMeasure, detectMeasure } from "./requirement-measure";

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
