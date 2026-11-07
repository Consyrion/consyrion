import { describe, expect, it } from "vitest";
import { findRequirementConflicts } from "./requirement-conflicts";

describe("requirement conflicts (night test R2-04, 08.11.26)", () => {
  it("finds a deletion bound that is shorter than a retention bound", () => {
    const list = [
      "Jede Kopie der Audit-Logs einschließlich Backups und Archiven muss spätestens sieben Kalendertage nach Erstellung vollständig und unwiederbringlich gelöscht sein.",
      "Dieselben vollständigen Audit-Logs müssen mindestens 30 Kalendertage nach Erstellung wiederherstellbar und auslesbar bleiben.",
      "Das System muss mindestens 50 Audit-Ereignisse pro Sekunde verarbeiten können.",
      "Die monatlichen Betriebskosten dürfen 300 CHF nicht überschreiten.",
    ];
    expect(findRequirementConflicts(list)).toEqual([{ first: 0, second: 1, deleteWithinDays: 7, retainDays: 30 }]);
  });

  it("finds it in English and with weeks, and stays quiet when the bounds fit", () => {
    expect(findRequirementConflicts(["Logs must be deleted within 2 weeks.", "Logs must be retained for at least 30 days."])).toHaveLength(1);
    expect(findRequirementConflicts(["Logs must be deleted after 90 days at the latest.", "Logs must stay available for at least 30 days."])).toEqual([]);
    expect(findRequirementConflicts(["Kosten höchstens 300 CHF.", "Mindestens 30 Tage Support."])).toEqual([]);
  });
});
