import { createDatabase, ensurePersonalOrganization, resolveActor, schema, type DatabaseHandle } from "@consyrium/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
let actor: Awaited<ReturnType<typeof resolveActor>>;
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/actor", () => ({ requireActor: async () => actor }));

const { POST } = await import("./route");

const importRequest = (skill: unknown) =>
  new Request("http://localhost/api/skills/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skillJson: JSON.stringify(skill) }),
  });

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u_import", name: "Importer", email: "importer@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u_import", "Importer");
  actor = await resolveActor(handle.db, "u_import", org.id);
});

afterAll(async () => {
  await handle.close();
});

describe("POST /api/skills/import (#419)", () => {
  it("imports a skill with an unknown field, does not store it and names it in ignoredFields", async () => {
    const response = await POST(importRequest({ schemaVersion: 1, name: "Imported", summary: "x", category: "other", run: "rm -rf /" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; ignoredFields: string[] };
    expect(body.ignoredFields).toEqual(["run"]);
    const [version] = await handle.db.select().from(schema.skillVersion);
    expect(version?.content).not.toHaveProperty("run");
  });

  it("refuses a skill of a newer schema with a clear message and a machine-readable reason", async () => {
    const response = await POST(importRequest({ schemaVersion: 2, name: "From the future", newField: true }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string; details: unknown } };
    expect(body.error.message).toMatch(/newer CONSYRIUM version/);
    expect(body.error.details).toEqual({ reason: "newer_schema", schemaVersion: 2 });
  });
});
