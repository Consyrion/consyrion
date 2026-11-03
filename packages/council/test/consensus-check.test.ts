import { describe, expect, it } from "vitest";
import { contradictionCaveat, summaryContradictions } from "../src/consensus-check";

const B_V2 =
  "Offline SQLite store. Backups via the SQLite Online Backup API or VACUUM INTO instead of copying the live file. Restore only through a staging folder; create a rollback copy of the current file before replacement; stop the application during the swap; document integrity checks and write tests after the restore.";
const A_V2 = "Embedded database with nightly backups, integrity checks, staging area for restores and rollback copies.";
const proposals = [
  { label: "A", version: 2, text: A_V2 },
  { label: "B", version: 2, text: B_V2 },
];

describe("consensus summary vs. current revisions (#105)", () => {
  it("flags a statement that calls measures missing which the current revision contains", () => {
    const statement =
      "Proposal A emphasizes a more comprehensive backup and restore process detailing integrity checks, staging areas, and rollback copies, while Proposal B lacks these specifics.";
    const [c] = summaryContradictions([statement], proposals);
    expect(c).toMatchObject({ label: "B", version: 2 });
    expect(c!.present).toEqual(expect.arrayContaining(["integrity", "stag", "rollback"]));
    expect(contradictionCaveat(c!)).toContain("Proposal B v2 does contain");
  });

  it("keeps real differences", () => {
    const real = [
      "Proposal B lacks multi-device synchronisation and conflict resolution.",
      "Proposal A uses PostgreSQL while Proposal B stays with SQLite.",
      "The proposals disagree on whether a cloud fallback is needed.",
    ];
    expect(summaryContradictions(real, proposals)).toEqual([]);
  });
});
