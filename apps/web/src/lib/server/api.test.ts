import { DomainError } from "@consyrium/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertSameOrigin, handle, readJson, toErrorResponse } from "./api";

describe("API error mapping", () => {
  it("maps domain errors to HTTP status codes", async () => {
    expect(toErrorResponse(new DomainError("FORBIDDEN", "nope")).status).toBe(403);
    expect(toErrorResponse(new DomainError("UNAUTHENTICATED", "x")).status).toBe(401);
    const response = toErrorResponse(new DomainError("VALIDATION", "bad", { fieldErrors: { name: ["required"] } }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION", details: { fieldErrors: { name: ["required"] } } } });
  });

  it("hides unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The structured logger only records the error type, never its message.
    const response = await handle(async () => {
      throw new Error("db password=hunter2 leaked");
    })();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("rejects non-JSON bodies", async () => {
    await expect(readJson(new Request("http://x", { method: "POST", body: "not json" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("CSRF protection (#396)", () => {
  const env = { BETTER_AUTH_URL: "https://app.consyrium.test" };
  const req = (method: string, headers: Record<string, string> = {}) => new Request("http://0.0.0.0:3000/api/tokens", { method, headers });

  it("lets the app's own pages through", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin", origin: "https://app.consyrium.test" }), env)).not.toThrow();
    // Local development: the request origin itself.
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/x", { method: "POST", headers: { origin: "http://localhost:3000" } }), {})).not.toThrow();
  });

  it("refuses cross-site and same-site (sibling subdomain) requests", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.test" }), env)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assertSameOrigin(req("DELETE", { "sec-fetch-site": "same-site", origin: "https://blog.consyrium.test" }), env)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    // Older browsers without Sec-Fetch-Site still send Origin.
    expect(() => assertSameOrigin(req("PATCH", { origin: "https://evil.test" }), env)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => assertSameOrigin(req("POST", { origin: "null" }), env)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("does not check safe methods, API tokens or clients without browser headers", () => {
    expect(() => assertSameOrigin(req("GET", { "sec-fetch-site": "cross-site", origin: "https://evil.test" }), env)).not.toThrow();
    expect(() => assertSameOrigin(req("POST", { authorization: "Bearer cns_abc", origin: "https://evil.test" }), env)).not.toThrow();
    expect(() => assertSameOrigin(req("POST"), env)).not.toThrow();
  });

  it("runs before the handler", async () => {
    const fn = vi.fn(async (_request: Request) => new Response("ok"));
    const response = await handle(fn)(req("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.test" }));
    expect(response.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("requires a JSON content type from browsers, but not from API tokens", async () => {
    const body = JSON.stringify({ role: "owner" });
    await expect(readJson(new Request("http://x", { method: "POST", headers: { "content-type": "text/plain" }, body }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(readJson(new Request("http://x", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body }))).resolves.toEqual({ role: "owner" });
    await expect(readJson(new Request("http://x", { method: "POST", headers: { authorization: "Bearer cns_abc" }, body }))).resolves.toEqual({ role: "owner" });
  });

  it("lets multipart uploads through from the app itself and from API tokens", () => {
    const form = new FormData();
    form.set("file", new File(["x"], "a.txt"));
    const upload = (headers: Record<string, string>) => new Request("http://0.0.0.0:3000/api/projects/p/documents", { method: "POST", headers, body: form });
    expect(() => assertSameOrigin(upload({ "sec-fetch-site": "same-origin", origin: "https://app.consyrium.test" }), env)).not.toThrow();
    expect(() => assertSameOrigin(upload({ authorization: "Bearer cni_abc" }), env)).not.toThrow();
    expect(() => assertSameOrigin(upload({ "sec-fetch-site": "cross-site", origin: "https://evil.test" }), env)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("does not apply to MCP or the signed webhooks, which are not wrapped in handle()", () => {
    // These receive calls without a browser origin or JSON content type (JSON-RPC clients, Stripe, GitHub, Telegram)
    // and authenticate by token or signature instead.
    for (const route of ["mcp", "billing/webhook", "github/webhook", "telegram/[connectionId]"]) {
      const source = readFileSync(join(__dirname, "../../app/api", route, "route.ts"), "utf8");
      expect(source, route).not.toMatch(/\bhandle\(/);
    }
  });

  it("leaves the GitHub setup callback alone (a GET redirect from github.com)", () => {
    expect(() => assertSameOrigin(req("GET", { "sec-fetch-site": "cross-site", origin: "https://github.com" }), env)).not.toThrow();
  });
});
