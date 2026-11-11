import { DomainError, isOrgRole, type OrgRole } from "@consyrium/core";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { membership } from "../schema";

/** Every tenant-scoped repository call receives an actor resolved from a real membership row. */
export interface ActorContext {
  userId: string;
  organizationId: string;
  role: OrgRole;
}

export async function resolveActor(db: Database, userId: string, organizationId: string): Promise<ActorContext> {
  const [row] = await db
    .select({ role: membership.role })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.organizationId, organizationId)))
    .limit(1);
  // Same error for "not a member" and "organization does not exist" to avoid tenant enumeration.
  if (!row || !isOrgRole(row.role)) throw new DomainError("NOT_FOUND", "Organization not found");
  return { userId, organizationId, role: row.role };
}
