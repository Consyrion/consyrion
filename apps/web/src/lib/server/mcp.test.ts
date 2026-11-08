import { createApiToken, createDatabase, ensurePersonalOrganization, resolveActor, schema, setSubscriptionPlan, type DatabaseHandle } from "@consyrion/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
vi.mock("./db", () => ({ getDb: async () => handle.db }));

const { handleMcpMessage } = await import("./mcp");
const { mcpTools } = await import("./mcp-tools");
const { POST } = await import("../../app/api/mcp/route");

let tokens: { read: string; integration: string };
let orgId: string;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["u", "admin"]) await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  const org = await ensurePersonalOrganization(handle.db, "u", "U");
  orgId = org.id;
  const actor = await resolveActor(handle.db, "u", org.id);
  tokens = {
    read: (await createApiToken(handle.db, actor, { name: "MCP read", days: 30, scope: "read" })).token,
    integration: (await createApiToken(handle.db, actor, { name: "MCP", days: 30 })).token,
  };
});
afterAll(async () => {
  await handle.close();
});

const rpc = (token: string | null, body: unknown) =>
  POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

describe("MCP protocol", () => {
  const tool = {
    name: "echo",
    title: "Echo",
    description: "d",
    inputSchema: { type: "object" },
    write: false,
    run: async (a: Record<string, unknown>) => ({ got: a }),
  };

  it("negotiates the protocol version, lists tools with annotations and calls them", async () => {
    const init = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, [tool])) as {
      result: { protocolVersion: string; capabilities: object };
    };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ tools: { listChanged: false } });
    const unknownVersion = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, [tool])) as {
      result: { protocolVersion: string };
    };
    expect(unknownVersion.result.protocolVersion).toBe("2025-11-25");
    const list = (await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, [tool])) as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
    };
    expect(list.result.tools[0]).toMatchObject({ name: "echo", annotations: { readOnlyHint: true } });
    const call = (await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { x: 1 } } }, [tool])) as {
      result: { structuredContent: unknown; isError: boolean };
    };
    expect(call.result).toMatchObject({ structuredContent: { got: { x: 1 } }, isError: false });
  });

  it("answers notifications with nothing, unknown methods/tools with JSON-RPC errors, tool failures as isError results", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, [tool])).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "resources/list" }, [tool])).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "drop_tables" } }, [tool])).toMatchObject({
      error: { code: -32602 },
    });
    const failing = { ...tool, run: async () => Promise.reject(new TypeError("internal detail")) };
    const failed = (await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo" } }, [failing])) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(failed.result.isError).toBe(true);
    expect(failed.result.content[0]!.text).not.toContain("internal detail");
  });
});

describe("MCP endpoint", () => {
  it("needs a token (401 with WWW-Authenticate) and the Pro plan (403 on Free)", async () => {
    const anonymous = await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("Bearer");
    const free = await rpc(tokens.integration, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(free.status).toBe(403);
    expect(((await free.json()) as { error: { message: string } }).error.message).toContain("Pro");
  });

  it("on Pro: read-only tokens get only read tools; integration tokens also prepare and start councils – never approve, build or delete", async () => {
    await setSubscriptionPlan(handle.db, "admin", orgId, "pro");
    const names = async (token: string) => {
      const res = await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(200);
      return ((await res.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    };
    const readTools = await names(tokens.read);
    expect(readTools).toEqual(["list_projects", "list_decisions", "get_decision", "list_open_steps", "list_models", "get_requirements", "preview_council", "list_skills"]);
    const all = await names(tokens.integration);
    expect(all).toEqual([...readTools, "ask_consyrion", "create_project_draft", "update_brief", "propose_requirements", "start_council"]);
    expect(all.some((n) => /approve|reject|build|delete|archive|key|billing|member|confirm/.test(n))).toBe(false);
    const notification = await rpc(tokens.read, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
  });

  it("creates a project draft over MCP, refuses start_council without or above the budget limit", async () => {
    const res = await rpc(tokens.integration, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "create_project_draft", arguments: { name: "MCP Projekt", idea: "Eine Idee, die lang genug ist." } },
    });
    const body = (await res.json()) as { result: { structuredContent: { url: string }; isError: boolean } };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.url).toMatch(/^http:\/\/localhost:3000\/projects\/prj_/);
    const actor = await resolveActor(handle.db, "u", orgId);
    const start = mcpTools(handle.db, actor, "integration", "http://x").find((t) => t.name === "start_council")!;
    await expect(start.run({ projectId: "prj_x", mode: "consensus", participants: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(start.run({ projectId: "prj_x", mode: "consensus", participants: [], tokenBudget: 5_000_000 })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("ask_consyrion needs a budget and models: without participants and without an earlier council it refuses before creating anything", async () => {
    const actor = await resolveActor(handle.db, "u", orgId);
    const ask = mcpTools(handle.db, actor, "integration", "http://x").find((t) => t.name === "ask_consyrion")!;
    await expect(ask.run({ question: "Postgres oder SQLite?", context: "Sync-Dienst" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(ask.run({ question: "Postgres oder SQLite?", context: "Sync-Dienst", tokenBudget: 100_000 })).rejects.toThrow(/participants/);
  });

  it("ask_consyrion accepts file excerpts (#331): path + content, at most 20, no other fields", async () => {
    const actor = await resolveActor(handle.db, "u", orgId);
    const ask = mcpTools(handle.db, actor, "integration", "http://x").find((t) => t.name === "ask_consyrion")!;
    const files = (ask.inputSchema.properties as Record<string, { maxItems?: number; items?: { required?: string[]; additionalProperties?: boolean } }>).files!;
    expect(files.maxItems).toBe(20);
    expect(files.items).toMatchObject({ required: ["path", "content"], additionalProperties: false });
  });

  it("a refused ask_consyrion start leaves no active project behind (QA 07.11.26)", async () => {
    const actor = await resolveActor(handle.db, "u", orgId);
    const ask = mcpTools(handle.db, actor, "integration", "http://x").find((t) => t.name === "ask_consyrion")!;
    const active = async () => (await handle.db.select().from(schema.project)).filter((p) => p.status !== "archived").length;
    const before = await active();
    await expect(
      ask.run({
        question: "Postgres oder SQLite für den Sync-Dienst?",
        context: "Kleiner Sync-Dienst",
        tokenBudget: 100_000,
        participants: [
          { credentialId: "cred_missing_a", modelId: "model-a" },
          { credentialId: "cred_missing_b", modelId: "model-b" },
        ],
      }),
    ).rejects.toBeDefined();
    expect(await active()).toBe(before);
  });

  it("refuses batches above 20 messages (#405)", async () => {
    await setSubscriptionPlan(handle.db, "admin", orgId, "pro");
    const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    const response = await rpc(tokens.read, batch);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32600);
    const ok = await rpc(tokens.read, batch.slice(0, 2));
    expect(ok.status).toBe(200);
  });
});
