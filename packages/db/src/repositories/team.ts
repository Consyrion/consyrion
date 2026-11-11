import { assertCan, canAssignRole, DomainError, isOrgRole, type OrgRole } from "@consyrium/core";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
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
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "member.invitation_revoked", targetType: "invitation", targetId: invitationId });
}

/**
 * Joins the workspace of an invitation. With `requireVerifiedEmail` (whenever the server verifies addresses, #404) the
 * account's address must be verified: otherwise whoever holds the link could register the invited address and join.
 */
export async function acceptInvitation(db: Database, userId: string, token: string, options: { requireVerifiedEmail?: boolean } = {}) {
  const [invite] = await db.select().from(invitation).where(eq(invitation.tokenHash, hash(token)));
  if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) throw new DomainError("NOT_FOUND", "This invitation is invalid or expired");
  const [account] = await db.select().from(user).where(eq(user.id, userId));
  if (!account || account.email.toLowerCase() !== invite.email) throw new DomainError("FORBIDDEN", `This invitation is for ${invite.email}. Sign in with that address.`);
  if (options.requireVerifiedEmail && !account.emailVerified) throw new DomainError("FORBIDDEN", `Confirm ${invite.email} first (link in your inbox), then open the invitation again.`);
  await db.transaction(async (tx) => {
    // Claim the invitation first and only if it is still open, so the same link cannot be used twice in parallel.
    const claimed = await tx
      .update(invitation)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitation.id, invite.id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
      .returning({ id: invitation.id });
    if (!claimed[0]) throw new DomainError("NOT_FOUND", "This invitation is invalid or expired");
    await tx.insert(membership).values({ id: newId("mem"), organizationId: invite.organizationId, userId, role: invite.role }).onConflictDoNothing();
    await recordAudit(tx, { organizationId: invite.organizationId, actorUserId: userId, action: "member.joined", targetType: "membership", targetId: userId, metadata: { role: invite.role } });
  });
  const [org] = await db.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.id, invite.organizationId));
  return org!;
}

/**
 * Owners of a workspace, locked for the rest of the transaction (#404): two owners demoting or removing each other at
 * the same moment must not leave the workspace without an owner. The second transaction waits and then sees one owner.
 */
async function lockedOwnerCount(tx: Pick<Database, "select">, organizationId: string) {
  const rows = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.organizationId, organizationId), eq(membership.role, "owner")))
    .for("update");
  return rows.length;
}

export async function changeMemberRole(db: Database, ctx: ActorContext, membershipId: string, role: string) {
  assertCan(ctx.role, "member:manage");
  if (!isOrgRole(role)) throw new DomainError("VALIDATION", "Unknown role");
  const [target] = await db.select().from(membership).where(and(eq(membership.id, membershipId), eq(membership.organizationId, ctx.organizationId)));
  if (!target) throw new DomainError("NOT_FOUND", "Member not found");
  if (!canAssignRole(ctx.role, role as OrgRole) || !canAssignRole(ctx.role, target.role)) throw new DomainError("FORBIDDEN", "You cannot change this member's role");
  await db.transaction(async (tx) => {
    if (target.role === "owner" && role !== "owner" && (await lockedOwnerCount(tx, ctx.organizationId)) <= 1) throw new DomainError("CONFLICT", "The workspace needs at least one owner");
    await tx.update(membership).set({ role: role as OrgRole }).where(eq(membership.id, membershipId));
  });
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
  await db.transaction(async (tx) => {
    if (target.role === "owner" && (await lockedOwnerCount(tx, ctx.organizationId)) <= 1) throw new DomainError("CONFLICT", "The last owner cannot leave or be removed");
    await tx.delete(membership).where(eq(membership.id, membershipId));
  });
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: self ? "member.left" : "member.removed", targetType: "membership", targetId: membershipId });
}
