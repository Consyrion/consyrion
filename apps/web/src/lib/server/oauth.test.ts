import { createHash, randomBytes } from "node:crypto";
import { createDatabase, ensurePersonalOrganization, resolveActor, resolveApiToken, schema, type ActorContext, type DatabaseHandle } from "@consyrium/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
vi.mock("./db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
// The consent action reads the session through requireActor; null = signed out.
let sessionActor: ActorContext | null = null;
const requireActor = vi.fn(async (_options?: { sessionOnly?: boolean }) => {
  if (!sessionActor) throw new Error("UNAUTHENTICATED");
  return sessionActor;
});
vi.mock("@/lib/server/actor", () => ({ requireActor }));

const { appOrigin, authorizationServerMetadata, authorizeQuery, mcpChallenge, protectedResourceMetadata, readAuthorizeRequest, redirectWith } = await import(
  "./oauth"
);
const resourceRoute = await import("../../app/.well-known/oauth-protected-resource/route");
const resourceMcpRoute = await import("../../app/.well-known/oauth-protected-resource/api/mcp/route");
const serverRoute = await import("../../app/.well-known/oauth-authorization-server/route");
const registerRoute = await import("../../app/api/oauth/register/route");
const tokenRoute = await import("../../app/api/oauth/token/route");
const { decideAuthorization } = await import("../../app/oauth/authorize/actions");

const ORIGIN = "http://localhost:3000";
const REDIRECT = "http://127.0.0.1:53682/callback";
let actor: ActorContext;
let ip = 0;
/** Every request comes from its own address unless a test is about the rate limit. */
const nextIp = () => `198.51.100.${++ip % 250}`;

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const register = (body: unknown, headers: Record<string, string> = {}) =>
  registerRoute.POST(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const token = (fields: Record<string, string>, as: "form" | "json" = "form", headers: Record<string, string> = {}) =>
  tokenRoute.POST(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": as === "form" ? "application/x-www-form-urlencoded" : "application/json", "x-forwarded-for": nextIp(), ...headers },
      body: as === "form" ? new URLSearchParams(fields).toString() : JSON.stringify(fields),
    }),
  );
const consent = (query: string, decision: string, organizationId = actor.organizationId) => {
  const form = new FormData();
  form.set("query", query);
  form.set("organization_id", organizationId);
  form.set("decision", decision);
  return decideAuthorization({ redirectTo: null, error: null }, form);
};
async function newClient(redirectUris = [REDIRECT]) {
  const response = await register({ client_name: "Claude Code", redirect_uris: redirectUris });
  expect(response.status).toBe(201);
  return (await json(response)).client_id as string;
}
const authorizeParams = (clientId: string, challenge: string, extra: Record<string, string> = {}) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  ...extra,
});

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values([
    { id: "u", name: "U", email: "u@example.test" },
    { id: "other", name: "O", email: "o@example.test" },
  ]);
  actor = await resolveActor(handle.db, "u", (await ensurePersonalOrganization(handle.db, "u", "U")).id);
  await ensurePersonalOrganization(handle.db, "other", "O");
});
afterAll(async () => {
  await handle.close();
});
beforeEach(() => {
  sessionActor = actor;
  requireActor.mockClear();
});

describe("OAuth metadata documents", () => {
  it("uses the configured public address without a trailing slash, else the request origin", () => {
    const request = new Request("http://0.0.0.0:3000/api/mcp");
    expect(appOrigin(request, { BETTER_AUTH_URL: "https://app.consyrium.com/" })).toBe("https://app.consyrium.com");
    expect(appOrigin(request, {})).toBe("http://localhost:3000");
  });

  it("describes the MCP endpoint as a protected resource (RFC 9728) – at the root and at the resource path", async () => {
    const expected = {
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      scopes_supported: ["councils", "read"],
    };
    expect(protectedResourceMetadata(ORIGIN)).toEqual(expected);
    for (const route of [resourceRoute, resourceMcpRoute]) {
      const response = route.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual(expected);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(route.OPTIONS().status).toBe(204);
      expect(route.OPTIONS().headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("describes the authorization server (RFC 8414): code + PKCE S256, public clients, no refresh tokens", async () => {
    const response = serverRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await json(response);
    expect(body).toEqual({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["councils", "read"],
    });
    expect(body).toEqual(authorizationServerMetadata(ORIGIN));
    expect(serverRoute.OPTIONS().status).toBe(204);
  });

  it("the MCP challenge points to the protected-resource metadata", () => {
    expect(mcpChallenge("https://app.consyrium.com")).toBe(
      'Bearer realm="consyrium", resource_metadata="https://app.consyrium.com/.well-known/oauth-protected-resource"',
    );
  });
});

describe("POST /api/oauth/register", () => {
  it("registers a public client (201) – never a secret, whatever was asked for", async () => {
    const response = await register({
      client_name: "Claude Code",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json(response);
    expect(body).toEqual({
      client_id: expect.stringMatching(/^cnc_/),
      client_name: "Claude Code",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
    expect(registerRoute.OPTIONS().headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("answers bad requests in the RFC 7591 shape", async () => {
    for (const [body, error] of [
      [{ client_name: "x", redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri"],
      [{ client_name: "x", redirect_uris: ["http://example.com/cb"] }, "invalid_redirect_uri"],
      [{ client_name: "x", redirect_uris: ["myapp://cb"] }, "invalid_redirect_uri"],
      [{ client_name: "x" }, "invalid_redirect_uri"],
      [{ client_name: "x".repeat(81), redirect_uris: [REDIRECT] }, "invalid_client_metadata"],
      ["not json", "invalid_request"],
      [[1, 2], "invalid_request"],
    ] as const) {
      const response = await register(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toEqual({ error, error_description: expect.any(String) });
    }
    const form = await register("client_name=x", { "content-type": "application/x-www-form-urlencoded" });
    expect(form.status).toBe(400);
  });

  it("is limited per address", async () => {
    const headers = { "x-forwarded-for": "203.0.113.99" };
    for (let i = 0; i < 20; i++) expect((await register({ client_name: "x", redirect_uris: [REDIRECT] }, headers)).status).toBe(201);
    const limited = await register({ client_name: "x", redirect_uris: [REDIRECT] }, headers);
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: "temporarily_unavailable" });
  });
});

describe("authorization request (consent page)", () => {
  it("accepts a complete request and maps the scope", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();
    const parsed = await readAuthorizeRequest(handle.db, authorizeParams(clientId, challenge, { state: "abc", resource: `${ORIGIN}/api/mcp` }));
    expect(parsed).toMatchObject({ ok: true, request: { redirectUri: REDIRECT, state: "abc", scope: "councils", tokenScope: "integration" } });
    const read = await readAuthorizeRequest(handle.db, authorizeParams(clientId, challenge, { scope: "read" }));
    expect(read).toMatchObject({ ok: true, request: { scope: "read", tokenScope: "read", state: null } });
    const both = await readAuthorizeRequest(handle.db, authorizeParams(clientId, challenge, { scope: "councils read" }));
    expect(both).toMatchObject({ ok: true, request: { scope: "councils", tokenScope: "integration" } });
  });

  it("names what is wrong – the redirect URI must match a registered one exactly", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();
    const base = authorizeParams(clientId, challenge);
    const problem = async (params: Record<string, string | string[] | undefined>) => {
      const parsed = await readAuthorizeRequest(handle.db, params);
      return parsed.ok ? "ok" : parsed.problem;
    };
    expect(await problem({ ...base, client_id: "cnc_unknown" })).toBe("client");
    expect(await problem({ ...base, client_id: undefined })).toBe("client");
    for (const redirect_uri of [
      undefined,
      "https://evil.example/cb",
      `${REDIRECT}/`,
      `${REDIRECT}?x=1`,
      "http://127.0.0.1:53683/callback",
      "http://localhost:53682/callback",
    ])
      expect(await problem({ ...base, redirect_uri }), String(redirect_uri)).toBe("redirect_uri");
    expect(await problem({ ...base, redirect_uri: [REDIRECT, REDIRECT] })).toBe("redirect_uri");
    expect(await problem({ ...base, response_type: "token" })).toBe("response_type");
    expect(await problem({ ...base, response_type: undefined })).toBe("response_type");
    expect(await problem({ ...base, code_challenge: undefined })).toBe("pkce");
    expect(await problem({ ...base, code_challenge_method: "plain" })).toBe("pkce");
    expect(await problem({ ...base, code_challenge_method: undefined })).toBe("pkce");
    expect(await problem({ ...base, code_challenge: "too-short" })).toBe("pkce");
    expect(await problem({ ...base, scope: "full" })).toBe("scope");
    expect(await problem({ ...base, scope: ["councils", "read"] })).toBe("scope");
    expect(await problem({ ...base, state: "x".repeat(513) })).toBe("state");
    expect(await problem({ ...base, state: ["a", "b"] })).toBe("state");
  });

  it("rebuilds the query for the sign-in detour and attaches the answer to the registered URI", async () => {
    const clientId = await newClient();
    const { challenge } = pkce();
    const parsed = await readAuthorizeRequest(handle.db, authorizeParams(clientId, challenge, { state: "a b&c", evil: "https://evil.example" }));
    if (!parsed.ok) throw new Error("expected a valid request");
    const query = authorizeQuery(parsed.request);
    expect(query).not.toContain("evil");
    expect(query).not.toContain("//");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ ...authorizeParams(clientId, challenge), scope: "councils", state: "a b&c" });

    expect(redirectWith(REDIRECT, { code: "c1" }, "a b&c")).toBe(`${REDIRECT}?code=c1&state=a+b%26c`);
    expect(redirectWith("https://example.com/cb?keep=1", { error: "access_denied" }, null)).toBe("https://example.com/cb?keep=1&error=access_denied");
    expect(redirectWith("obsidian://consyrium-auth", { code: "c1" }, "s")).toBe("obsidian://consyrium-auth?code=c1&state=s");
    expect(redirectWith("vscode://publisher.extension/callback", { code: "c1" }, "s")).toBe("vscode://publisher.extension/callback?code=c1&state=s");
  });
});

describe("consent action and token endpoint", () => {
  async function prepared(extra: Record<string, string> = {}) {
    const clientId = await newClient();
    const { verifier, challenge } = pkce();
    const query = new URLSearchParams(authorizeParams(clientId, challenge, { state: "st-1", ...extra })).toString();
    return { clientId, verifier, query };
  }
  const codeFrom = (redirectTo: string | null) => new URL(redirectTo!).searchParams.get("code")!;

  it("Allow → code at the registered redirect URI → token endpoint → an integration token that works", async () => {
    const { clientId, verifier, query } = await prepared();
    const allowed = await consent(query, "allow");
    expect(allowed.error).toBeNull();
    expect(requireActor).toHaveBeenCalledWith({ sessionOnly: true });
    const target = new URL(allowed.redirectTo!);
    expect(`${target.origin}${target.pathname}`).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("st-1");

    const response = await token({
      grant_type: "authorization_code",
      code: codeFrom(allowed.redirectTo),
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await json(response);
    expect(body).toEqual({ access_token: expect.stringMatching(/^cni_/), token_type: "Bearer", expires_in: 90 * 86_400, scope: "councils" });
    expect(await resolveApiToken(handle.db, body.access_token as string)).toEqual({ userId: "u", organizationId: actor.organizationId, scope: "integration" });
    expect(tokenRoute.OPTIONS().status).toBe(204);
  });

  it("the token endpoint also takes JSON; scope read gives a read-only token", async () => {
    const { clientId, verifier, query } = await prepared({ scope: "read" });
    const allowed = await consent(query, "allow");
    const response = await token(
      { grant_type: "authorization_code", code: codeFrom(allowed.redirectTo), redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier },
      "json",
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ access_token: expect.stringMatching(/^cnr_/), scope: "read" });
  });

  it("Deny → error=access_denied with the state, and no code exists", async () => {
    const before = (await handle.db.select().from(schema.oauthCode)).length;
    const { query } = await prepared();
    const denied = await consent(query, "deny");
    const target = new URL(denied.redirectTo!);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("st-1");
    expect(target.searchParams.get("code")).toBeNull();
    expect(await handle.db.select().from(schema.oauthCode)).toHaveLength(before);
  });

  it("the action trusts nothing from the form: tampered requests, signed-out visitors and foreign workspaces get no code and no redirect", async () => {
    const before = (await handle.db.select().from(schema.oauthCode)).length;
    const { clientId, query } = await prepared();
    const { challenge } = pkce();
    for (const tampered of [
      query.replace(encodeURIComponent(REDIRECT), encodeURIComponent("https://evil.example/cb")),
      `${query}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}`,
      query.replace("code_challenge_method=S256", "code_challenge_method=plain"),
      new URLSearchParams(authorizeParams(clientId, challenge, { scope: "full" })).toString(),
      new URLSearchParams(authorizeParams("consyrium-obsidian", challenge)).toString(),
      "",
    ])
      expect(await consent(tampered, "allow"), tampered).toEqual({ redirectTo: null, error: "invalid" });
    expect(await consent(query, "maybe")).toEqual({ redirectTo: null, error: "invalid" });

    const otherOrg = (await ensurePersonalOrganization(handle.db, "other", "O")).id;
    expect(await consent(query, "allow", otherOrg)).toEqual({ redirectTo: null, error: "session" });
    expect(await consent(query, "allow", "")).toEqual({ redirectTo: null, error: "session" });
    sessionActor = null;
    expect(await consent(query, "allow")).toEqual({ redirectTo: null, error: "session" });
    expect(await consent(query, "deny")).toEqual({ redirectTo: null, error: "session" });
    expect(await handle.db.select().from(schema.oauthCode)).toHaveLength(before);
  });

  it("answers refusals in the RFC 6749 shape: replay, wrong verifier, wrong grant type, missing fields", async () => {
    const { clientId, verifier, query } = await prepared();
    const code = codeFrom((await consent(query, "allow")).redirectTo);
    const fields = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier };

    const wrongVerifier = await token({ ...fields, code_verifier: pkce().verifier });
    expect(wrongVerifier.status).toBe(400);
    expect(wrongVerifier.headers.get("cache-control")).toBe("no-store");
    expect(await json(wrongVerifier)).toEqual({ error: "invalid_grant", error_description: expect.any(String) });
    // The wrong attempt burned the code.
    expect(await json(await token(fields))).toMatchObject({ error: "invalid_grant" });

    expect(await json(await token({ ...fields, grant_type: "refresh_token" }))).toMatchObject({ error: "unsupported_grant_type" });
    expect(await json(await token({ ...fields, grant_type: "client_credentials" }))).toMatchObject({ error: "unsupported_grant_type" });
    for (const missing of ["code", "redirect_uri", "client_id", "code_verifier"] as const) {
      const response = await token({ ...fields, [missing]: "" });
      expect(response.status).toBe(400);
      expect(await json(response)).toMatchObject({ error: "invalid_request" });
    }
    const twice = await tokenRoute.POST(
      new Request(`${ORIGIN}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": nextIp() },
        body: `${new URLSearchParams(fields).toString()}&code=other`,
      }),
    );
    expect(await json(twice)).toMatchObject({ error: "invalid_request" });
    const text = await tokenRoute.POST(
      new Request(`${ORIGIN}/api/oauth/token`, { method: "POST", headers: { "content-type": "text/plain", "x-forwarded-for": nextIp() }, body: "x" }),
    );
    expect(await json(text)).toMatchObject({ error: "invalid_request" });
  });

  it("the token endpoint is limited per address", async () => {
    const headers = { "x-forwarded-for": "203.0.113.98" };
    const fields = { grant_type: "authorization_code", code: "unknown", redirect_uri: REDIRECT, client_id: "x", code_verifier: "v".repeat(43) };
    for (let i = 0; i < 30; i++) expect((await token(fields, "form", headers)).status).toBe(400);
    expect((await token(fields, "form", headers)).status).toBe(429);
  });
});
