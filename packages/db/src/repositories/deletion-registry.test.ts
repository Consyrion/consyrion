import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { auditEvent, councilSession, deletionTombstone, job, organization, project, projectBrief, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { deletionLine, recordDeletion } from "./deletion-registry";
import { ensurePersonalOrganization } from "./organizations";
import { createProject } from "./projects";

const SCRUB_SQL = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../deploy/hetzner/post-restore-scrub.sql"), "utf8");
const brief = { idea: "A sufficiently long description of the project idea." };

let handle: DatabaseHandle;
let a: ActorContext;
let b: ActorContext;

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["ua", "ub"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  a = await resolveActor(handle.db, "ua", (await ensurePersonalOrganization(handle.db, "ua", "A")).id);
  b = await resolveActor(handle.db, "ub", (await ensurePersonalOrganization(handle.db, "ub", "B")).id);
});

afterEach(async () => {
  await handle.close();
});

/** Runs post-restore-scrub.sql like the shell script does: one transaction, scrub_list filled first. */
async function scrub(lines: Array<{ kind: string; id: string; org: string }>) {
  let result = "";
  await handle.db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        "CREATE TEMP TABLE scrub_list (deleted_at timestamptz NOT NULL, kind text NOT NULL, entity_id text NOT NULL, organization_id text NOT NULL) ON COMMIT DROP",
      ),
    );
    for (const l of lines) await tx.execute(sql`INSERT INTO scrub_list VALUES (now(), ${l.kind}, ${l.id}, ${l.org})`);
    for (const statement of SCRUB_SQL.replace(/^--.*$/gm, "")
      .split(/;\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      const out = await tx.execute(sql.raw(statement));
      const rows = (out as unknown as { rows?: Array<{ result?: string }> }).rows;
      if (rows?.[0]?.result) result = rows[0].result;
    }
  });
  return result;
}

async function session(id: string, ctx: ActorContext, projectId: string) {
  const [pb] = await handle.db.select().from(projectBrief).where(eq(projectBrief.projectId, projectId));
  await handle.db.insert(councilSession).values({
    id,
    organizationId: ctx.organizationId,
    projectId,
    briefId: pb!.id,
    mode: "independent_expert",
    policy: {},
    policyVersion: 1,
    tokenBudget: 1000,
    createdById: ctx.userId,
  });
}

describe("ADR 0206 deletion list", () => {
  it("records ids and time only, in the file and as a tombstone", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "del-")), "deletions.log");
    const at = new Date("2026-11-08T20:00:00.000Z");
    await recordDeletion(handle.db, { kind: "project", id: "prj_abc", organizationId: a.organizationId, deletedAt: at }, { DELETIONS_LOG: file });
    expect(readFileSync(file, "utf8")).toBe(`2026-11-08T20:00:00.000Z project prj_abc ${a.organizationId}\n`);
    expect(await handle.db.select().from(deletionTombstone)).toEqual([
      { kind: "project", entityId: "prj_abc", organizationId: a.organizationId, deletedAt: at },
    ]);
    // Repeating it (a retried purge) adds a line but no second tombstone.
    await recordDeletion(handle.db, { kind: "project", id: "prj_abc", organizationId: a.organizationId, deletedAt: at }, { DELETIONS_LOG: file });
    expect(await handle.db.select().from(deletionTombstone)).toHaveLength(1);
  });

  it("never throws into a purge and refuses odd ids", async () => {
    await expect(
      recordDeletion(handle.db, { kind: "session", id: "ses_1", organizationId: "org_1", deletedAt: new Date() }, { DELETIONS_LOG: "/nonexistent/dir/x.log" }),
    ).resolves.toBeUndefined();
    await recordDeletion(handle.db, { kind: "session", id: "x'; drop table user;--", organizationId: "org_1", deletedAt: new Date() }, {});
    expect((await handle.db.select().from(deletionTombstone)).map((t) => t.entityId)).toEqual(["ses_1"]);
    expect(deletionLine({ kind: "workspace", id: "org_1", organizationId: "org_1", deletedAt: new Date("2026-01-01T00:00:00Z") })).toBe(
      "2026-01-01T00:00:00.000Z workspace org_1 org_1\n",
    );
  });
});

describe("ADR 0206 post-restore scrub", () => {
  it("removes listed workspaces, projects and sessions with their queued jobs, keeps everything else", async () => {
    // The "restored" database still holds what was deleted after the backup.
    const gone = await createProject(handle.db, b, { name: "Deleted later", type: "idea", brief });
    const kept = await createProject(handle.db, b, { name: "Kept", type: "idea", brief });
    await session("ses_gone", b, kept.id);
    await session("ses_kept", b, kept.id);
    await handle.db.insert(job).values([
      { id: "job_a", kind: "council.run", payload: { sessionId: "x" }, organizationId: a.organizationId },
      { id: "job_s", kind: "council.run", payload: { sessionId: "ses_gone" }, organizationId: b.organizationId },
      { id: "job_k", kind: "council.run", payload: { sessionId: "ses_kept" }, organizationId: b.organizationId },
    ] as Array<typeof job.$inferInsert>);

    const out = await scrub([
      { kind: "workspace", id: a.organizationId, org: a.organizationId },
      { kind: "project", id: gone.id, org: b.organizationId },
      { kind: "session", id: "ses_gone", org: b.organizationId },
    ]);
    expect(out).toBe("scrubbed workspaces=1 projects=1 sessions=1");
    expect((await handle.db.select().from(organization)).map((o) => o.id)).toEqual([b.organizationId]);
    expect((await handle.db.select().from(project)).map((p) => p.id)).toEqual([kept.id]);
    expect((await handle.db.select().from(councilSession)).map((s) => s.id)).toEqual(["ses_kept"]);
    expect((await handle.db.select().from(job)).map((j) => j.id)).toEqual(["job_k"]);
    expect((await handle.db.select().from(deletionTombstone)).length).toBe(3);
    const [audit] = await handle.db.select().from(auditEvent).where(eq(auditEvent.action, "privacy.restore_scrubbed"));
    expect(audit!.metadata).toEqual({ workspaces: 1, projects: 1, sessions: 1 });

    // Idempotent: a second run finds nothing and writes no audit entry.
    expect(await scrub([{ kind: "workspace", id: a.organizationId, org: a.organizationId }])).toBe("scrubbed workspaces=0 projects=0 sessions=0");
    expect(await handle.db.select().from(auditEvent).where(eq(auditEvent.action, "privacy.restore_scrubbed"))).toHaveLength(1);
  }, 60_000);

  it("uses the restored database's own tombstones and removes projects still marked deleting", async () => {
    const p = await createProject(handle.db, b, { name: "Half deleted", type: "idea", brief });
    await handle.db
      .update(project)
      .set({ status: "deleting" } as never)
      .where(eq(project.id, p.id));
    await handle.db
      .insert(deletionTombstone)
      .values({ kind: "workspace", entityId: a.organizationId, organizationId: a.organizationId, deletedAt: new Date() });
    expect(await scrub([])).toBe("scrubbed workspaces=1 projects=1 sessions=0");
    expect((await handle.db.select().from(organization)).map((o) => o.id)).toEqual([b.organizationId]);
  }, 60_000);
});
