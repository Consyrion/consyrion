/**
 * "Connect with CONSYRIUM AI": sign in in the browser instead of copying an API token (OAuth authorization code with
 * PKCE, the plugin is the built-in public client `consyrium-obsidian`). The pure parts live here – no Obsidian
 * imports: creating the request, building the address of the consent page, checking what comes back through
 * `obsidian://consyrium-auth`, and exchanging the one-time code. The HTTP call is injected like in api.ts.
 */
import { ConsyriumError, type Http } from "./api";

export const CONNECT_CLIENT_ID = "consyrium-obsidian";
/** Obsidian protocol action; the server accepts exactly this redirect URI for the plugin. */
export const CONNECT_ACTION = "consyrium-auth";
export const CONNECT_REDIRECT_URI = `obsidian://${CONNECT_ACTION}`;
/** A started sign-in is kept in memory this long; afterwards the answer is ignored. */
export const CONNECT_TTL_MS = 10 * 60_000;

/** A sign-in the user started and that has not come back yet. Kept in memory only – never in data.json. */
export interface PendingConnect {
  /** Random value the answer must repeat, so only an answer to this request is accepted. */
  state: string;
  /** PKCE secret; only its hash went to the browser. */
  verifier: string;
  /** The validated server address the request was started for – the code is redeemed there and nowhere else. */
  server: string;
  expiresAt: number;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes as 43 base64url characters (a valid PKCE verifier and an unguessable state). */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE S256: base64url(sha256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** Address of the consent page for this request. */
export function authorizeUrl(server: string, challenge: string, state: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CONNECT_CLIENT_ID,
    redirect_uri: CONNECT_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "councils",
  });
  return `${server}/oauth/authorize?${query.toString()}`;
}

/** Starts a sign-in for an already validated server address: what to remember and the page to open. */
export async function startConnect(server: string, now = Date.now()): Promise<{ pending: PendingConnect; url: string }> {
  const pending: PendingConnect = { state: randomToken(), verifier: randomToken(), server, expiresAt: now + CONNECT_TTL_MS };
  return { pending, url: authorizeUrl(server, await codeChallenge(pending.verifier), pending.state) };
}

export type CallbackResult =
  | { ok: true; code: string }
  /**
   * `unexpected`: nothing was started here, or the answer belongs to another request – ignored, a running request stays.
   * `expired`, `denied`, `failed`: this request is over.
   */
  | { ok: false; reason: "unexpected" | "expired" | "denied" | "failed"; detail?: string };

/**
 * Checks the parameters Obsidian hands over for `obsidian://consyrium-auth?…`. Any page or app can open such a link,
 * so an answer counts only when its `state` is the one of the request started here; everything else is ignored.
 */
export function checkCallback(pending: PendingConnect | null, params: Record<string, string | undefined>, now = Date.now()): CallbackResult {
  if (!pending || typeof params.state !== "string" || params.state !== pending.state) return { ok: false, reason: "unexpected" };
  if (now > pending.expiresAt) return { ok: false, reason: "expired" };
  if (params.error) {
    // Shown to the user: only a short code, never free text from the link.
    const detail = /^[a-z_]{1,40}$/.test(params.error) ? params.error : "error";
    return { ok: false, reason: params.error === "access_denied" ? "denied" : "failed", detail };
  }
  if (!params.code || params.code.length > 200) return { ok: false, reason: "failed", detail: "no_code" };
  return { ok: true, code: params.code };
}

/** Exchanges the one-time code for the API token at the server the request was started for. */
export async function redeemCode(http: Http, pending: PendingConnect, code: string): Promise<string> {
  let response;
  try {
    response = await http({
      url: `${pending.server}/api/oauth/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CONNECT_REDIRECT_URI,
        client_id: CONNECT_CLIENT_ID,
        code_verifier: pending.verifier,
      }).toString(),
    });
  } catch {
    throw new ConsyriumError("offline", "offline");
  }
  let body: { access_token?: unknown; error?: unknown } = {};
  try {
    body = JSON.parse(response.text) as typeof body;
  } catch {
    /* not JSON */
  }
  if (response.status === 200 && typeof body.access_token === "string" && /^cn[a-z]_[A-Za-z0-9_-]{20,}$/.test(body.access_token)) return body.access_token;
  if (response.status === 429) throw new ConsyriumError("rate_limited", "rate limited", 429);
  const error = typeof body.error === "string" && /^[a-z_]{1,40}$/.test(body.error) ? body.error : `HTTP ${response.status}`;
  throw new ConsyriumError(response.status >= 500 ? "server" : "auth", error, response.status);
}
