import { DomainError } from "@consyrium/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { membership, organization } from "../schema";
import { recordAudit } from "./audit";

export const organizationInput = z.object({
  name: z.string().trim().min(2).max(80),
});

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${newId("org").slice(-6)}`;
}

export async function createOrganization(db: Database, userId: string, input: z.input<typeof organizationInput>) {
  const parsed = organizationInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid organization", parsed.error.flatten());
  return db.transaction(async (tx) => {
    const id = newId("org");
    const [org] = await tx.insert(organization).values({ id, name: parsed.data.name, slug: slugify(parsed.data.name) }).returning();
    await tx.insert(membership).values({ id: newId("mem"), organizationId: id, userId, role: "owner" });
    await recordAudit(tx, { organizationId: id, actorUserId: userId, action: "organization.created", targetType: "organization", targetId: id });
    return org!;
  });
}

export async function listOrganizationsForUser(db: Database, userId: string) {
  return db
    .select({ id: organization.id, name: organization.name, slug: organization.slug, role: membership.role })
    .from(membership)
    .innerJoin(organization, eq(membership.organizationId, organization.id))
    .where(eq(membership.userId, userId))
    .orderBy(asc(organization.createdAt));
}

/** Gives every new user a workspace so the first project can be created immediately. */
export async function ensurePersonalOrganization(db: Database, userId: string, displayName: string) {
  const existing = await listOrganizationsForUser(db, userId);
  if (existing[0]) return existing[0];
  const org = await createOrganization(db, userId, { name: `${displayName.trim() || "My"} workspace`.slice(0, 80) });
  return { id: org.id, name: org.name, slug: org.slug, role: "owner" as const };
}
