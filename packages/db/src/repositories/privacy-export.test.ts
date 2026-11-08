import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import * as schema from "../schema";
import { createApiToken } from "./api-tokens";
import { resolveActor, type ActorContext } from "./context";
import { ensurePersonalOrganization } from "./organizations";
import { EXPORT_COVERAGE, EXPORT_FORMAT_VERSION, exportOrganization } from "./privacy";
import { createProject } from "./projects";

const brief = { idea: "A sufficiently long description of the project idea." };

describe("#206 export coverage", () => {
  it("lists every table of the schema as exported or excluded on purpose", () => {
    const tables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table as PgTable))
      .sort();
    const missing = tables.filter((name) => !(name in EXPORT_COVERAGE));
    const stale = Object.keys(EXPORT_COVERAGE).filter((name) => !tables.includes(name));
    expect(missing, "new tables must be added to EXPORT_COVERAGE in privacy.ts").toEqual([]);
    expect(stale, "EXPORT_COVERAGE names tables that no longer exist").toEqual([]);
  });

  it("every exported table appears in the export under its key", async () => {
    const handle = createDatabase("memory://");
    await handle.migrate();
    await handle.db.insert(schema.user).values({ id: "u1", name: "U1", email: "u1@example.test" });
    const actor = await resolveActor(handle.db, "u1", (await ensurePersonalOrganization(handle.db, "u1", "U1")).id);
    const data = (await exportOrganization(handle.db, actor)) as Record<string, unknown>;
    for (const entry of Object.values(EXPORT_COVERAGE)) {
      if ("exported" in entry) expect(Object.keys(data), entry.exported).toContain(entry.exported.split(" ")[0]);
    }
    expect(data.exportFormat).toBe(EXPORT_FORMAT_VERSION);
    await handle.close();
  }, 60_000);
});

describe("#206 export content", () => {
  let handle: DatabaseHandle;
  let a: ActorContext;
  let b: ActorContext;

  beforeEach(async () => {
    handle = createDatabase("memory://");
    await handle.migrate();
    for (const id of ["ua", "ub"]) await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
    a = await resolveActor(handle.db, "ua", (await ensurePersonalOrganization(handle.db, "ua", "A")).id);
    b = await resolveActor(handle.db, "ub", (await ensurePersonalOrganization(handle.db, "ub", "B")).id);
  });

  afterEach(async () => {
    await handle.close();
  });

  it("contains only the exporting workspace's data", async () => {
    await createProject(handle.db, a, { name: "Mine", type: "idea", brief });
    await createProject(handle.db, b, { name: "Theirs", type: "idea", brief });
    const json = JSON.stringify(await exportOrganization(handle.db, a));
    expect(json).toContain("Mine");
    expect(json).not.toContain("Theirs");
    expect(json).not.toContain(b.organizationId);
  });

  it("leaves out token hashes and encrypted secrets", async () => {
    const token = await createApiToken(handle.db, a, { name: "CI", days: 30 });
    // Inserted directly: the starter plan allows no further members, and only the export is tested here.
    await handle.db.insert(schema.invitation).values({
      id: "inv1",
      organizationId: a.organizationId,
      email: "guest@example.test",
      role: "member",
      tokenHash: "INVITATION-TOKEN-HASH",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdById: "ua",
    } as typeof schema.invitation.$inferInsert);
    await handle.db.insert(schema.deliveryConnection).values({
      id: "dc1",
      organizationId: a.organizationId,
      kind: "telegram",
      label: "Team chat",
      config: { chatId: "123" },
      encryptedSecret: "ENCRYPTED-SECRET-VALUE",
      keyVersion: 1,
      secretHint: "…1234",
      createdById: "ua",
    } as typeof schema.deliveryConnection.$inferInsert);
    const data = await exportOrganization(handle.db, a);
    const json = JSON.stringify(data);
    expect(data.apiTokens).toHaveLength(1);
    expect(data.invitations).toHaveLength(1);
    expect(data.deliveryConnections).toEqual([expect.objectContaining({ id: "dc1", label: "Team chat", secretHint: "…1234" })]);
    for (const secret of ["tokenHash", "encryptedSecret", "INVITATION-TOKEN-HASH", "ENCRYPTED-SECRET-VALUE", (token as { token?: string }).token ?? "no-token"])
      expect(json).not.toContain(secret);
  });
});
