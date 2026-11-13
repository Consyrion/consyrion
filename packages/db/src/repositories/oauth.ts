import {
  cleanClientName,
  DomainError,
  isAllowedRedirectUri,
  OAUTH_MAX_REDIRECT_URIS,
  OAUTH_OBSIDIAN_REDIRECT_URI,
  OAuthError,
  PKCE_CHALLENGE_PATTERN,
  PKCE_VERIFIER_PATTERN,
  redirectTarget,
  validRedirectUris,
} from "@consyrium/core";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { oauthClient, oauthCode } from "../schema";
import { createApiToken } from "./api-tokens";
import { recordAudit } from "./audit";
import { resolveActor, type ActorContext } from "./context";

/**
 * OAuth sign-in for MCP clients and the Obsidian plugin (docs/mcp.md): authorization code + PKCE (S256) for public
 * clients. The result of a successful exchange is an ordinary API token (`api_token`, created through
 * `createApiToken`), so everything that already holds for manual tokens – scopes, expiry, revocation under
 * Settings → API tokens, membership re-checked on every request – holds for connected apps too.
 * No refresh tokens and no client secrets.
 */

/** A code must be redeemed within two minutes. */
export const OAUTH_CODE_TTL_MS = 2 * 60_000;
/** Validity of the API token a client receives; afterwards the user signs in again. */
export const OAUTH_TOKEN_DAYS = 90;

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  /** Built into this server (our own apps) instead of registered by somebody over the open registration endpoint. */
  firstParty: boolean;
}

/** First-party clients need no registration and no database row. */
export const OBSIDIAN_CLIENT_ID = "consyrium-obsidian";
const BUILT_IN_CLIENTS: ReadonlyMap<string, OAuthClient> = new Map([
  [OBSIDIAN_CLIENT_ID, { clientId: OBSIDIAN_CLIENT_ID, name: "CONSYRIUM AI for Obsidian", redirectUris: [OAUTH_OBSIDIAN_REDIRECT_URI], firstParty: true }],
]);

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * Dynamic client registration (RFC 7591) for public clients. Open to anybody by design of the MCP authorization
 * flow – a registration grants nothing by itself; the user decides on the consent page, which shows the redirect target.
 */
export async function registerClient(db: Database, input: { name: unknown; redirectUris: unknown }): Promise<OAuthClient> {
  const redirectUris = validRedirectUris(input.redirectUris);
  if (!redirectUris)
    throw new OAuthError(
      "invalid_redirect_uri",
      `redirect_uris must hold 1 to ${OAUTH_MAX_REDIRECT_URIS} URIs: https, http on localhost/127.0.0.1/[::1], or a supported app scheme; no fragments`,
    );
  // A client that sends no name is shown by the host it redirects to – the one fact about it that cannot be made up.
  const name = input.name === undefined || input.name === null || input.name === "" ? redirectTarget(redirectUris[0]!) : cleanClientName(input.name);
  if (!name) throw new OAuthError("invalid_client_metadata", "client_name must be a text of 1 to 80 characters");
  const clientId = `cnc_${randomBytes(18).toString("base64url")}`;
  await db.insert(oauthClient).values({ id: newId("oac"), clientId, name, redirectUris });
  return { clientId, name, redirectUris, firstParty: false };
}

/** A built-in or registered client; null when the id is unknown. */
export async function getClient(db: Database, clientId: string): Promise<OAuthClient | null> {
  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 100) return null;
  const builtIn = BUILT_IN_CLIENTS.get(clientId);
  if (builtIn) return builtIn;
  const [row] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
  // Stored URIs are checked again: a rule that got stricter after a registration must not be bypassed by an old row.
  return row ? { clientId: row.clientId, name: row.name, redirectUris: row.redirectUris.filter(isAllowedRedirectUri), firstParty: false } : null;
}

/**
 * The signed-in user (`ctx`) allows a client: stores a one-time code bound to this user, workspace, client, redirect
 * URI and PKCE challenge. Everything is validated here again – the consent page is not trusted. The plain code is
 * returned once and only its hash is stored.
 */
export async function createAuthorizationCode(
  db: Database,
  ctx: ActorContext,
  input: { clientId: string; redirectUri: string; codeChallenge: string; scope: "integration" | "read" },
): Promise<{ code: string; expiresAt: Date }> {
  const client = await getClient(db, input.clientId);
  if (!client) throw new DomainError("VALIDATION", "Unknown client");
  if (!isAllowedRedirectUri(input.redirectUri) || !client.redirectUris.includes(input.redirectUri))
    throw new DomainError("VALIDATION", "The redirect URI is not registered for this client");
  if (typeof input.codeChallenge !== "string" || !PKCE_CHALLENGE_PATTERN.test(input.codeChallenge))
    throw new DomainError("VALIDATION", "A PKCE code challenge (S256) is required");
  if (input.scope !== "integration" && input.scope !== "read") throw new DomainError("VALIDATION", "Unknown scope");
  const code = randomBytes(32).toString("base64url");
  const id = newId("oad");
  const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_MS);
  // Codes that expired more than a day ago are of no use to anybody; removing them here needs no extra job.
  await db.delete(oauthCode).where(lt(oauthCode.expiresAt, new Date(Date.now() - 86_400_000)));
  await db.insert(oauthCode).values({
    id,
    codeHash: sha256(code).toString("hex"),
    clientId: client.clientId,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    expiresAt,
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "oauth.authorized",
    targetType: "oauth_client",
    targetId: client.clientId,
    metadata: { clientName: client.name, firstParty: client.firstParty, redirectTarget: redirectTarget(input.redirectUri), scope: input.scope },
  });
  return { code, expiresAt };
}

const INVALID_GRANT = "The authorization code is invalid, expired or was already used";

/**
 * Redeems a code for an API token (`POST /api/oauth/token`). One statement marks the code as used and returns it, so
 * two parallel requests can never both succeed. Client, redirect URI and the PKCE verifier are checked afterwards: any
 * mismatch fails with the same `invalid_grant`, and the code stays consumed – whoever presents a stolen code without
 * the verifier burns it.
 */
export async function exchangeAuthorizationCode(
  db: Database,
  input: { code: unknown; clientId: unknown; redirectUri: unknown; codeVerifier: unknown },
): Promise<{ token: string; scope: "integration" | "read"; expiresIn: number }> {
  const fail = () => new OAuthError("invalid_grant", INVALID_GRANT);
  if (typeof input.code !== "string" || input.code.length < 1 || input.code.length > 200) throw fail();
  const now = new Date();
  const [row] = await db
    .update(oauthCode)
    .set({ usedAt: now })
    .where(and(eq(oauthCode.codeHash, sha256(input.code).toString("hex")), isNull(oauthCode.usedAt), gt(oauthCode.expiresAt, now)))
    .returning();
  if (!row) throw fail();
  if (typeof input.clientId !== "string" || input.clientId !== row.clientId) throw fail();
  if (typeof input.redirectUri !== "string" || input.redirectUri !== row.redirectUri) throw fail();
  if (typeof input.codeVerifier !== "string" || !PKCE_VERIFIER_PATTERN.test(input.codeVerifier)) throw fail();
  const expected = Buffer.from(row.codeChallenge, "base64url");
  const actual = sha256(input.codeVerifier);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw fail();
  if (row.scope !== "integration" && row.scope !== "read") throw fail();
  const client = await getClient(db, row.clientId);
  if (!client) throw fail();
  // The user may have left the workspace between consent and exchange.
  let actor: ActorContext;
  try {
    actor = await resolveActor(db, row.userId, row.organizationId);
  } catch {
    throw fail();
  }
  const { token } = await createApiToken(db, actor, {
    name: `Connected: ${client.name}`.slice(0, 60),
    days: OAUTH_TOKEN_DAYS,
    scope: row.scope,
    via: `oauth:${client.clientId}`,
  });
  return { token, scope: row.scope, expiresIn: OAUTH_TOKEN_DAYS * 86_400 };
}
