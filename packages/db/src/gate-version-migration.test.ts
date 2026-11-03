import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client";

// Migration 0021 (#181, stage 1) marks every existing decision as gate version 1 without recomputing anything.
const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const before = mkdtempSync(path.join(tmpdir(), "consyrion-migrations-"));

afterAll(() => rmSync(before, { recursive: true, force: true }));

describe("migration 0021_gate_version", () => {
  it("marks existing decisions as legacy gate version 1 and leaves outcome and matrix untouched", async () => {
    // The migrations folder as it was before stage 1: same files, journal without 0021.
    cpSync(drizzleDir, before, { recursive: true });
    const journalPath = path.join(before, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
    // Later migrations (e.g. 0022_requirement_lists, #190) are cut off too: the database is at the state before 0021.
    const index = journal.entries.findIndex((e) => e.tag === "0021_gate_version");
    expect(index).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, index);
    writeFileSync(journalPath, JSON.stringify(journal));

    const old = createDatabase("memory://", { migrationsFolder: before });
    await old.migrate();
    // Only the decision rows matter here; foreign keys are switched off for this session to keep the fixture small.
    await old.db.execute(sql`SET session_replication_role = replica`);
    const matrix = { outcome: "recommended", recommendedProposalId: "p1", proposals: [{ proposalId: "p1", total: 8.1, implementable: true }] };
    await old.db.execute(
      sql`INSERT INTO final_decision (id, organization_id, session_id, outcome, recommended_proposal_id, matrix) VALUES
        ('d1', 'o1', 's1', 'recommended', 'p1', ${JSON.stringify(matrix)}::jsonb),
        ('d2', 'o1', 's2', 'no_qualifying_solution', NULL, '{"proposals":[]}'::jsonb)`,
    );
    await old.db.execute(sql`SET session_replication_role = DEFAULT`);

    // Same database, now with the full migrations folder: 0021 and every later migration run.
    await migrate(old.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: drizzleDir });

    const rows = await old.db.execute<{ id: string; gate_version: number | null; outcome: string; matrix: unknown }>(
      sql`SELECT id, gate_version, outcome, matrix FROM final_decision ORDER BY id`,
    );
    const list = (rows as unknown as { rows: Array<{ id: string; gate_version: number | null; outcome: string; matrix: unknown }> }).rows;
    expect(list.map((r) => [r.id, r.gate_version, r.outcome])).toEqual([
      ["d1", 1, "recommended"],
      ["d2", 1, "no_qualifying_solution"],
    ]);
    expect(list[0]!.matrix).toEqual(matrix);
    // The new outcome value exists, but nothing was rewritten to it.
    const values = (await old.db.execute(sql`SELECT unnest(enum_range(NULL::verdict_outcome))::text AS v`)) as unknown as { rows: Array<{ v: string }> };
    expect(values.rows.map((r) => r.v)).toContain("needs_verification");
    await old.close();
  }, 20_000);
});
