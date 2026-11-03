import { DomainError } from "@consyrion/core";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { apiToken } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

/**
 * Full-access tokens start with cns_, integration tokens with cni_ (#101). Releases before #101 accept only cns_, so a
 * rollback rejects integration tokens instead of silently giving them full access.
 */
export const API_TOKEN_SCOPES = ["integration", "full"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];
const PREFIXES: Record<ApiTokenScope, string> = { full: "cns_", integration: "cni_" };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a personal token for the current workspace. The plain token is returned exactly once. */
export async function createApiToken(db: Database, ctx: ActorContext, input: { name: string; days: number; scope?: string }) {
  const scope = input.scope ?? "integration";
  if (!(API_TOKEN_SCOPES as readonly string[]).includes(scope)) throw new DomainError("VALIDATION", "Scope must be 'integration' or 'full'");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) throw new DomainError("VALIDATION", "Give the token a name (max. 60 characters)");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw new DomainError("VALIDATION", "Validity must be 1–365 days");
  const token = `${PREFIXES[scope as ApiTokenScope]}${randomBytes(32).toString("base64url")}`;
  const id = newId("tok");
  await db.insert(apiToken).values({ id, userId: ctx.userId, organizationId: ctx.organizationId, name, tokenHash: hash(token), prefix: token.slice(0, 10), scope, expiresAt: new Date(Date.now() + input.days * 86_400_000) });
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "api_token.created", targetType: "api_token", targetId: id, metadata: { name, days: input.days, scope } });
  return { id, token, scope };
}

export async function listApiTokens(db: Database, ctx: ActorContext) {
  return db
    .select({ id: apiToken.id, name: apiToken.name, prefix: apiToken.prefix, scope: apiToken.scope, lastUsedAt: apiToken.lastUsedAt, expiresAt: apiToken.expiresAt, createdAt: apiToken.createdAt })
    .from(apiToken)
    .where(and(eq(apiToken.userId, ctx.userId), eq(apiToken.organizationId, ctx.organizationId), isNull(apiToken.revokedAt)))
    .orderBy(desc(apiToken.createdAt));
}

export async function revokeApiToken(db: Database, ctx: ActorContext, id: string) {
  const updated = await db
    .update(apiToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiToken.id, id), eq(apiToken.userId, ctx.userId)))
    .returning({ id: apiToken.id });
  if (!updated[0]) throw new DomainError("NOT_FOUND", "Token not found");
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "api_token.revoked", targetType: "api_token", targetId: id });
}

/** Resolves a bearer token to user, workspace and scope; unknown, revoked or expired tokens are rejected. */
export async function resolveApiToken(db: Database, token: string): Promise<{ userId: string; organizationId: string; scope: ApiTokenScope }> {
  const prefixScope = API_TOKEN_SCOPES.find((s) => token.startsWith(PREFIXES[s]));
  if (!prefixScope) throw new DomainError("UNAUTHENTICATED", "Invalid API token");
  const [row] = await db
    .select()
    .from(apiToken)
    .where(and(eq(apiToken.tokenHash, hash(token)), isNull(apiToken.revokedAt), gt(apiToken.expiresAt, new Date())));
  if (!row) throw new DomainError("UNAUTHENTICATED", "Invalid or expired API token");
  // Prefix and stored scope must agree; an unknown stored scope never widens access.
  if (row.scope !== prefixScope) throw new DomainError("UNAUTHENTICATED", "Invalid API token");
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.id));
  return { userId: row.userId, organizationId: row.organizationId, scope: prefixScope };
}
