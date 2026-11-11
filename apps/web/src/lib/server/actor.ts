import "server-only";
import { DomainError } from "@consyrium/core";
import { ensurePersonalOrganization, listOrganizationsForUser, resolveActor, resolveApiToken, type ActorContext } from "@consyrium/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { getDb } from "./db";

export const ACTIVE_ORG_COOKIE = "consyrium_org";
/** Cookie name before the rename (11 Nov 2026): still read so the active workspace survives; only the new one is written. */
const LEGACY_ACTIVE_ORG_COOKIE = "consyrion_org";

export async function getSessionUser() {
  // Read request headers before touching the database so Next.js treats every caller as dynamic.
  const requestHeaders = await headers();
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  return user;
}

/**
 * Resolves the organization the request acts in. The cookie is only a preference: membership is
 * always re-checked against the database.
 */
export async function requireActor(options: { integration?: boolean; sessionOnly?: boolean } = {}): Promise<ActorContext> {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    // Session only (#403): creating or revoking tokens and managing the team need the signed-in person in the web app.
    // Otherwise a leaked token could mint a fresh one (outliving its own revocation) or invite new owners.
    if (options.sessionOnly) throw new DomainError("FORBIDDEN", "This action is only available in the web app, not with an API token");
    // Personal API token (VS Code extension, automation): bound to one workspace, membership re-checked.
    const db = await getDb();
    const { userId, organizationId, scope } = await resolveApiToken(db, authorization.slice(7).trim());
    // Fail closed (#101): an integration token reaches only handlers that opted in with { integration: true }.
    // Approvals, builds, GitHub, keys, team, tokens, billing and deletions never do.
    // Read-only tokens (cnr_) are for the MCP server only (/api/mcp resolves them itself) and reach no REST endpoint.
    if (scope === "read") throw new DomainError("FORBIDDEN", "This API token is read-only and works only with the MCP server (/api/mcp)");
    if (scope !== "full" && !options.integration)
      throw new DomainError("FORBIDDEN", "This API token has the integration scope (councils only); this endpoint needs a full-access token or the web app");
    return resolveActor(db, userId, organizationId);
  }
  const user = await requireUser();
  const db = await getDb();
  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? (await cookies()).get(LEGACY_ACTIVE_ORG_COOKIE)?.value;
  const orgs = await listOrganizationsForUser(db, user.id);
  const target = orgs.find((org) => org.id === preferred) ?? orgs[0] ?? (await ensurePersonalOrganization(db, user.id, user.name));
  return resolveActor(db, user.id, target.id);
}

/** For server components: unauthenticated visitors are redirected instead of receiving an error. */
export async function requirePageActor(): Promise<ActorContext> {
  if (!(await getSessionUser())) redirect("/sign-in");
  return requireActor();
}
