import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createApiToken, createDatabase, ensurePersonalOrganization, resolveActor, schema, type DatabaseHandle } from "@consyrion/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let authorization: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(authorization ? { authorization } : {}),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./auth", () => ({ getAuth: async () => ({ api: { getSession: async () => null } }) }));
let handle: DatabaseHandle;
vi.mock("./db", () => ({ getDb: async () => handle.db }));

const { requireActor } = await import("./actor");

let full: string;
let integration: string;
let readOnly: string;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u", name: "U", email: "u@example.test" });
  const actor = await resolveActor(handle.db, "u", (await ensurePersonalOrganization(handle.db, "u", "U")).id);
  full = (await createApiToken(handle.db, actor, { name: "VS Code", days: 30, scope: "full" })).token;
  integration = (await createApiToken(handle.db, actor, { name: "Obsidian", days: 30 })).token;
  readOnly = (await createApiToken(handle.db, actor, { name: "MCP", days: 30, scope: "read" })).token;
});
afterAll(async () => {
  await handle.close();
});

describe("API token scopes (#101)", () => {
  it("an integration token reaches only handlers that opted in; a full token reaches every handler", async () => {
    authorization = `Bearer ${integration}`;
    await expect(requireActor()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireActor({ integration: true })).resolves.toMatchObject({ userId: "u" });
    authorization = `Bearer ${full}`;
    await expect(requireActor()).resolves.toMatchObject({ userId: "u" });
  });

  it("a read-only token (cnr_, MCP) reaches no REST endpoint – also not the council endpoints", async () => {
    expect(readOnly.startsWith("cnr_")).toBe(true);
    authorization = `Bearer ${readOnly}`;
    await expect(requireActor()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireActor({ integration: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only the council endpoints accept integration tokens – approvals, builds, keys, team, tokens and deletions never do", () => {
    const root = join(__dirname, "../../app/api");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : name === "route.ts" ? [join(dir, name)] : []));
    const opted = files(root).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = handle\(async[\s\S]*?(?=\nexport const |$)/g)]
        .filter((m) => m[0].includes("requireActor({ integration: true })"))
        .map((m) => `${m[1]} /${relative(root, file).replace(/\/?route\.ts$/, "")}`);
    });
    expect(opted.sort()).toEqual(
      [
        "GET /credentials",
        "GET /models",
        "GET /projects",
        "POST /projects",
        "GET /projects/[id]",
        "PATCH /projects/[id]",
        "GET /projects/[id]/documents",
        "POST /projects/[id]/documents",
        "DELETE /projects/[id]/documents/[docId]",
        "POST /projects/[id]/documents/[docId]/describe",
        "PUT /projects/[id]/documents/[docId]/description",
        "GET /projects/[id]/requirements",
        "POST /projects/[id]/requirements",
        "GET /projects/[id]/sessions",
        "POST /projects/[id]/sessions",
        "POST /projects/[id]/sessions/preview",
        "GET /sessions",
        "GET /sessions/[id]",
        "POST /sessions/[id]/cancel",
        "GET /sessions/[id]/events",
        "GET /sessions/[id]/report",
      ].sort(),
    );
  });
});
