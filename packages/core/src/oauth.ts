/**
 * Pure rules of the OAuth sign-in for MCP clients and the Obsidian plugin ("connect by signing in", docs/mcp.md):
 * which redirect URIs a client may register, which scopes exist and what the consent page shows as the target.
 * No I/O – the storage and the single-use code exchange live in packages/db/src/repositories/oauth.ts.
 */

export const OAUTH_MAX_REDIRECT_URIS = 5;
export const OAUTH_MAX_REDIRECT_URI_LENGTH = 300;
export const OAUTH_MAX_CLIENT_NAME_LENGTH = 80;

/**
 * Custom URI schemes a client may register. Dynamic registration is open to anybody, so app schemes are a fixed list:
 * the Obsidian action of our own plugin (exact URI – another plugin's `obsidian://…` action is never accepted) and the
 * desktop clients that receive OAuth callbacks on their own scheme.
 */
export const OAUTH_OBSIDIAN_REDIRECT_URI = "obsidian://consyrium-auth";
export const OAUTH_CUSTOM_SCHEME_PREFIXES = ["cursor://", "vscode://", "vscode-insiders://", "claude://"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Whitespace, control characters and backslashes never belong into a redirect URI (parser differences, header splitting). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u0020\u007f-\u009f\\]/;

/**
 * True when a client may register this redirect URI:
 * - `https://…` on any host,
 * - `http://` only on the loopback interface (`localhost`, `127.0.0.1`, `[::1]`, any port) for native clients,
 * - the custom schemes of the fixed list above.
 * Never: fragments, embedded credentials, `javascript:`, `data:`, `file:`, plain http to another host, other app schemes.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > OAUTH_MAX_REDIRECT_URI_LENGTH) return false;
  if (FORBIDDEN_CHARACTERS.test(value) || value.includes("#")) return false;
  if (value === OAUTH_OBSIDIAN_REDIRECT_URI) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    // The scheme must be written out with "//": "https:evil.example" and "https:/x" parse, but nobody means them.
    if (!value.toLowerCase().startsWith(`${url.protocol}//`)) return false;
    if (url.username || url.password || !url.hostname) return false;
    return url.protocol === "https:" || LOOPBACK_HOSTS.has(url.hostname);
  }
  // A custom scheme needs a target after "scheme://" – the part the consent page shows.
  return OAUTH_CUSTOM_SCHEME_PREFIXES.some((prefix) => value.startsWith(prefix)) && Boolean(url.host);
}

/** The list a client registers: 1–5 allowed URIs, no duplicates. Returns null when anything is wrong. */
export function validRedirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > OAUTH_MAX_REDIRECT_URIS) return null;
  if (!value.every(isAllowedRedirectUri)) return null;
  return new Set(value).size === value.length ? (value as string[]) : null;
}

/**
 * What the consent page shows as the place the access goes to: scheme and host only ("https://claude.ai",
 * "http://localhost:53682", "obsidian://consyrium-auth"). Path and query are left out so nothing can push the host out
 * of view. Call only with an allowed redirect URI.
 */
export function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return `${url.protocol}//${url.host}`;
}

/** OAuth scope names (public) and the API token scope each one becomes. */
export const OAUTH_SCOPES = ["councils", "read"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
export const OAUTH_TOKEN_SCOPE: Record<OAuthScope, "integration" | "read"> = { councils: "integration", read: "read" };

/**
 * Reads the `scope` parameter of an authorization request. Missing or empty → "councils". The value is a
 * space-separated list (RFC 6749 §3.3): MCP clients send every scope of `scopes_supported` unless told otherwise, so
 * "councils read" is "councils" (it includes the read tools). Any unknown name → null (the request is refused).
 */
export function parseOAuthScope(value: string | null | undefined): OAuthScope | null {
  const names = (value ?? "").split(" ").filter(Boolean);
  if (!names.length) return "councils";
  if (!names.every((name): name is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(name))) return null;
  return names.includes("councils") ? "councils" : "read";
}

/** A client name as registered: trimmed, control characters removed, 1–80 characters. Null when unusable. */
export function cleanClientName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return name.length >= 1 && name.length <= OAUTH_MAX_CLIENT_NAME_LENGTH ? name : null;
}

/** PKCE (RFC 7636): a code challenge is the base64url SHA-256 of the verifier – always 43 characters. */
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** A code verifier is 43–128 unreserved characters. */
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** Error codes of RFC 6749 §5.2 / §4.1.2.1 and RFC 7591 §3.2.2 that the OAuth endpoints answer with. */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_redirect_uri"
  | "invalid_client_metadata";

/** A refusal the OAuth endpoints send as `{ error, error_description }`. The description never contains a secret. */
export class OAuthError extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    description: string,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}
