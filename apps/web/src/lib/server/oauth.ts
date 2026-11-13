import {
  DomainError,
  OAUTH_SCOPES,
  OAUTH_TOKEN_SCOPE,
  OAuthError,
  PKCE_CHALLENGE_PATTERN,
  parseOAuthScope,
  type OAuthErrorCode,
  type OAuthScope,
} from "@consyrium/core";
import { getClient, type Database, type OAuthClient } from "@consyrium/db";
import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * HTTP side of the OAuth sign-in for MCP clients and the Obsidian plugin (docs/mcp.md "Sign-in (OAuth)"): the public
 * origin, the two metadata documents (RFC 9728, RFC 8414), RFC-shaped errors and the validation of an authorization
 * request. Storage and the code exchange: packages/db/src/repositories/oauth.ts.
 */

/** The public address of this installation, computed exactly like the MCP endpoint does for its links. */
export function appOrigin(request: Request, env: Record<string, string | undefined> = process.env): string {
  return env.BETTER_AUTH_URL?.replace(/\/$/, "") || new URL(request.url).origin.replace("0.0.0.0", "localhost");
}

/** Path of the protected-resource metadata; the MCP endpoint points to it in its 401 answer. */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/** `WWW-Authenticate` of the MCP endpoint: tells a client without a token where sign-in is described (RFC 9728 §5.1). */
export function mcpChallenge(origin: string): string {
  return `Bearer realm="consyrium", resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}"`;
}

/** RFC 9728: the MCP endpoint as a protected resource and the authorization server that issues its tokens. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

/** RFC 8414: authorization code + PKCE (S256) for public clients; no refresh tokens, no client secrets. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

/**
 * CORS for the metadata documents, registration and the token endpoint: browser-based MCP clients call them from
 * their own origin. Safe with `*` because none of them reads a cookie – the token endpoint is authenticated by the
 * one-time code and the PKCE verifier only. The consent page is not covered by this.
 */
export function corsHeaders(methods: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
}

export function corsPreflight(methods: string): Response {
  return new Response(null, { status: 204, headers: corsHeaders(methods) });
}

/** A metadata document: public, the same for everybody, briefly cacheable. */
export function metadataResponse(body: unknown): Response {
  return NextResponse.json(body, { headers: { ...corsHeaders("GET, OPTIONS"), "Cache-Control": "public, max-age=300" } });
}

const OAUTH_STATUS: Partial<Record<OAuthErrorCode, number>> = { invalid_client: 401 };

/** An error body as RFC 6749 §5.2 / RFC 7591 §3.2.2 define it; never cached. */
export function oauthErrorResponse(error: string, description: string, status: number, methods: string): Response {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { ...corsHeaders(methods), "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

/** Maps anything thrown inside an OAuth endpoint to an RFC-shaped answer without leaking internals. */
export function toOAuthErrorResponse(error: unknown, methods: string): Response {
  if (error instanceof OAuthError) return oauthErrorResponse(error.error, error.message, OAUTH_STATUS[error.error] ?? 400, methods);
  if (error instanceof DomainError && error.code === "RATE_LIMITED") return oauthErrorResponse("temporarily_unavailable", error.message, 429, methods);
  logger.error("Unhandled OAuth error", { error: error instanceof Error ? error.name : typeof error });
  return oauthErrorResponse("server_error", "Unexpected server error", 500, methods);
}

/** Largest request body the OAuth endpoints read (a registration with five long redirect URIs is far below). */
const MAX_BODY_CHARS = 20_000;

/**
 * Body of a registration or token request: JSON, or `application/x-www-form-urlencoded` as RFC 6749 asks for the
 * token endpoint. A parameter sent twice is refused (RFC 6749 §3.2).
 */
export async function readOAuthBody(request: Request, allowForm: boolean): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new OAuthError("invalid_request", "Request body too large");
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("application/json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* answered below */
    }
    throw new OAuthError("invalid_request", "Request body must be a JSON object");
  }
  if (allowForm && contentType.startsWith("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const out: Record<string, unknown> = {};
    for (const key of new Set(params.keys())) {
      if (params.getAll(key).length > 1) throw new OAuthError("invalid_request", `Parameter ${key.slice(0, 40)} must not be sent more than once`);
      out[key] = params.get(key);
    }
    return out;
  }
  throw new OAuthError("invalid_request", allowForm ? "Send application/x-www-form-urlencoded or application/json" : "Send application/json");
}

/** Why an authorization request cannot be shown for consent. The page explains it and never redirects anywhere. */
export type AuthorizeProblem = "response_type" | "client" | "redirect_uri" | "pkce" | "scope" | "state";

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  /** Opaque value of the client, given back unchanged with the redirect. */
  state: string | null;
  scope: OAuthScope;
  tokenScope: "integration" | "read";
}

const MAX_STATE_LENGTH = 512;

/**
 * Validates the parameters of `GET /oauth/authorize` – and again, unchanged, inside the consent action. Every value
 * must be present exactly once; the redirect URI must be one the client registered, character for character.
 * `resource` (RFC 8707) is accepted and ignored: this server has exactly one protected resource.
 */
export async function readAuthorizeRequest(
  db: Database,
  params: Record<string, string | string[] | undefined | null>,
): Promise<{ ok: true; request: AuthorizeRequest } | { ok: false; problem: AuthorizeProblem }> {
  const one = (name: string): string | null => {
    const value = params[name];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const repeated = (name: string) => Array.isArray(params[name]);
  const problem = (p: AuthorizeProblem) => ({ ok: false as const, problem: p });

  // Client and redirect URI first: nothing else matters when it is unknown where an answer would go.
  const clientId = one("client_id");
  const client = clientId ? await getClient(db, clientId) : null;
  if (!client) return problem("client");
  const redirectUri = one("redirect_uri");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return problem("redirect_uri");
  if (one("response_type") !== "code") return problem("response_type");
  const codeChallenge = one("code_challenge");
  if (!codeChallenge || one("code_challenge_method") !== "S256" || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) return problem("pkce");
  if (repeated("scope")) return problem("scope");
  const scope = parseOAuthScope(one("scope"));
  if (!scope) return problem("scope");
  const state = one("state");
  // eslint-disable-next-line no-control-regex
  if (repeated("state") || (state !== null && (state.length > MAX_STATE_LENGTH || /[\u0000-\u001f\u007f]/.test(state)))) return problem("state");
  return { ok: true, request: { client, redirectUri, codeChallenge, state, scope, tokenScope: OAUTH_TOKEN_SCOPE[scope] } };
}

/** The query of an authorization request, rebuilt from validated values (for `/sign-in?next=…` and the form). */
export function authorizeQuery(request: AuthorizeRequest): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: request.client.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    scope: request.scope,
  });
  if (request.state !== null) query.set("state", request.state);
  return query.toString();
}

/** The registered redirect URI with the answer attached: `code` or `error`, plus the client's `state`. */
export function redirectWith(redirectUri: string, answer: { code: string } | { error: string }, state: string | null): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(answer)) url.searchParams.set(key, value);
  if (state !== null) url.searchParams.set("state", state);
  return url.toString();
}
