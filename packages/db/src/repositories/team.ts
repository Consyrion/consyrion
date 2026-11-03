import { assertCan, canAssignRole, DomainError, isOrgRole, type OrgRole } from "@consyrion/core";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gte, isNull } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { invitation, membership, organization, user } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { assertEntitlement } from "./saas";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listMembers(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:read");
  return db
    .select({ id: membership.id, userId: user.id, name: user.name, email: user.email, role: membership.role, joinedAt: membership.createdAt })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.organizationId, ctx.organizationId))
    .orderBy(asc(membership.createdAt));
}

/**
 * Creates an invitation link (no e-mail is sent; the inviter shares the link). Only the invited
 * address can accept it, it expires after 7 days and counts against the plan's seats.
 */
export async function createInvitation(db: Database, ctx: ActorContext, input: { email: string; role: string }) {
  assertCan(ctx.role, "member:manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new DomainError("VALIDATION", "Enter a valid e-mail address");
  if (!isOrgRole(input.role) || !canAssignRole(ctx.role, input.role)) throw new DomainError("FORBIDDEN", "You cannot invite with this role");
  const [existingMember] = await db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.organizationId, ctx.organizationId), eq(user.email, email)));
  if (existingMember) throw new DomainError("CONFLICT", "This person is already a member");
  await assertEntitlement(db, ctx.organizationId, "member");
  const token = randomBytes(24).toString("base64url");
  const id = newId("inv");
  await db.insert(invitation).values({ id, organizationId: ctx.organizationId, email, role: input.role, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), createdById: ctx.userId });
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "member.invited", targetType: "invitation", targetId: id, metadata: { role: input.role } });
  return { id, token };
}

export async function listInvitations(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "member:manage");
  return db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt })
    .from(invitation)
    .where(and(eq(invitation.organizationId, ctx.organizationId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt), gte(invitation.expiresAt, new Date())))
    .orderBy(asc(invitation.createdAt));
}

export async function revokeInvitation(db: Database, ctx: ActorContext, invitationId: string) {
  assertCan(ctx.role, "member:manage");
  const updated = await db
    .update(invitation)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, ctx.organizationId), isNull(invitation.acceptedAt)))
    .returning({ id: invitation.id });
  if (!updated[0]) throw new DomainError("NOT_FOUND", "Invitation not found");
}

export async function acceptInvitation(db: Database, userId: string, token: string) {
  const [invite] = await db.select().from(invitation).where(eq(invitation.tokenHash, hash(token)));
  if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) throw new DomainError("NOT_FOUND", "This invitation is invalid or expired");
  const [account] = await db.select().from(user).where(eq(user.id, userId));
  if (!account || account.email.toLowerCase() !== invite.email) throw new DomainError("FORBIDDEN", `This invitation is for ${invite.email}. Sign in with that address.`);
  await db.transaction(async (tx) => {
    await tx.insert(membership).values({ id: newId("mem"), organizationId: invite.organizationId, userId, role: invite.role }).onConflictDoNothing();
    await tx.update(invitation).set({ acceptedAt: new Date() }).where(eq(invitation.id, invite.id));
    await recordAudit(tx, { organizationId: invite.organizationId, actorUserId: userId, action: "member.joined", targetType: "membership", targetId: userId, metadata: { role: invite.role } });
  });
  const [org] = await db.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.id, invite.organizationId));
  return org!;
}

async function ownerCount(db: Database, organizationId: string) {
  const [row] = await db.select({ n: count() }).from(membership).where(and(eq(membership.organizationId, organizationId), eq(membership.role, "owner")));
  return row!.n;
}

export async function changeMemberRole(db: Database, ctx: ActorContext, membershipId: string, role: string) {
  assertCan(ctx.role, "member:manage");
  if (!isOrgRole(role)) throw new DomainError("VALIDATION", "Unknown role");
  const [target] = await db.select().from(membership).where(and(eq(membership.id, membershipId), eq(membership.organizationId, ctx.organizationId)));
  if (!target) throw new DomainError("NOT_FOUND", "Member not found");
  if (!canAssignRole(ctx.role, role as OrgRole) || !canAssignRole(ctx.role, target.role)) throw new DomainError("FORBIDDEN", "You cannot change this member's role");
  if (target.role === "owner" && role !== "owner" && (await ownerCount(db, ctx.organizationId)) <= 1) throw new DomainError("CONFLICT", "The workspace needs at least one owner");
  await db.update(membership).set({ role: role as OrgRole }).where(eq(membership.id, membershipId));
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "member.role_changed", targetType: "membership", targetId: membershipId, metadata: { from: target.role, to: role } });
}

export async function removeMember(db: Database, ctx: ActorContext, membershipId: string) {
  const [target] = await db.select().from(membership).where(and(eq(membership.id, membershipId), eq(membership.organizationId, ctx.organizationId)));
  if (!target) throw new DomainError("NOT_FOUND", "Member not found");
  const self = target.userId === ctx.userId;
  if (!self) {
    assertCan(ctx.role, "member:manage");
    if (!canAssignRole(ctx.role, target.role)) throw new DomainError("FORBIDDEN", "You cannot remove this member");
  }
  if (target.role === "owner" && (await ownerCount(db, ctx.organizationId)) <= 1) throw new DomainError("CONFLICT", "The last owner cannot leave or be removed");
  await db.delete(membership).where(eq(membership.id, membershipId));
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: self ? "member.left" : "member.removed", targetType: "membership", targetId: membershipId });
}
