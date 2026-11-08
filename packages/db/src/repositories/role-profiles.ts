import {
  assertCan,
  can,
  CURATED_ROLE_PROFILES,
  curatedRoleProfile,
  DomainError,
  roleProfileContentHash,
  validateRoleProfileContent,
  type CouncilRole,
  type RoleProfileContent,
  type RoleProfileSessionSnapshot,
  type RoleProfileVisibility,
} from "@consyrion/core";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { roleProfile, roleProfileVersion } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

/**
 * Expert Library, stage 1 (#270): role profiles for the existing 12 Minds roles. Visibility per profile: "private"
 * (only the author, the default) or "team" (every member of the workspace; sharing needs an admin or owner). Curated
 * profiles (`curated:<slug>`) are read-only and visible to everyone. Content is validated and scanned on every save;
 * versions are immutable, and a council stores a snapshot of the version it used.
 */

export interface RoleProfileSummary {
  id: string;
  role: CouncilRole;
  name: string;
  coreQuestion: string;
  visibility: RoleProfileVisibility | "curated";
  version: number;
  contentHash: string;
  /** Whether the caller may change it (author of an own profile). */
  editable: boolean;
  ownerUserId: string | null;
  updatedAt: Date | null;
}

const visibleTo = (ctx: ActorContext) =>
  and(
    eq(roleProfile.organizationId, ctx.organizationId),
    isNull(roleProfile.archivedAt),
    or(eq(roleProfile.visibility, "team"), eq(roleProfile.ownerUserId, ctx.userId)),
  );

function checked(input: unknown): { content: RoleProfileContent; ignoredFields: string[] } {
  const result = validateRoleProfileContent(input);
  if (!result.ok) throw new DomainError("VALIDATION", result.errors.join("; "));
  return { content: result.content, ignoredFields: result.ignoredFields };
}

/** Curated profiles plus the workspace's profiles the caller may see (own private ones and all team ones). */
export async function listRoleProfiles(db: Database, ctx: ActorContext): Promise<RoleProfileSummary[]> {
  assertCan(ctx.role, "project:read");
  const rows = await db
    .select({ profile: roleProfile, version: roleProfileVersion })
    .from(roleProfile)
    .innerJoin(roleProfileVersion, and(eq(roleProfileVersion.profileId, roleProfile.id), eq(roleProfileVersion.version, roleProfile.latestVersion)))
    .where(visibleTo(ctx))
    .orderBy(desc(roleProfile.updatedAt));
  return [
    ...rows.map(({ profile: p, version: v }) => {
      const content = v.content as unknown as RoleProfileContent;
      return {
        id: p.id,
        role: content.role,
        name: content.name,
        coreQuestion: content.coreQuestion,
        visibility: p.visibility,
        version: v.version,
        contentHash: v.contentHash,
        editable: p.ownerUserId === ctx.userId,
        ownerUserId: p.ownerUserId,
        updatedAt: p.updatedAt,
      };
    }),
    ...CURATED_ROLE_PROFILES.map((c) => ({
      id: `curated:${c.slug}`,
      role: c.content.role,
      name: c.content.name,
      coreQuestion: c.content.coreQuestion,
      visibility: "curated" as const,
      version: c.version,
      contentHash: roleProfileContentHash(c.content),
      editable: false,
      ownerUserId: null,
      updatedAt: null,
    })),
  ];
}

/**
 * A profile version for use (council setup, detail view): the latest one unless `version` is given. Refused unless the
 * caller may see the profile; a deactivated profile only with `allowArchived` (views of councils that already used it).
 */
export async function getRoleProfile(
  db: Database,
  ctx: ActorContext,
  profileId: string,
  version?: number,
  options: { allowArchived?: boolean } = {},
): Promise<{ snapshot: RoleProfileSessionSnapshot; visibility: RoleProfileVisibility | "curated"; editable: boolean }> {
  assertCan(ctx.role, "project:read");
  const curated = curatedRoleProfile(profileId);
  if (curated) {
    if (version !== undefined && version !== curated.version) throw new DomainError("NOT_FOUND", "Role profile version not found");
    return {
      snapshot: { profileId, version: curated.version, contentHash: roleProfileContentHash(curated.content), content: curated.content },
      visibility: "curated",
      editable: false,
    };
  }
  const [row] = await db
    .select()
    .from(roleProfile)
    .where(
      and(
        eq(roleProfile.id, profileId),
        eq(roleProfile.organizationId, ctx.organizationId),
        or(eq(roleProfile.visibility, "team"), eq(roleProfile.ownerUserId, ctx.userId)),
      ),
    );
  if (!row || (row.archivedAt && !options.allowArchived)) throw new DomainError("NOT_FOUND", "Role profile not found");
  const [v] = await db
    .select()
    .from(roleProfileVersion)
    .where(
      and(
        eq(roleProfileVersion.profileId, profileId),
        eq(roleProfileVersion.organizationId, ctx.organizationId),
        eq(roleProfileVersion.version, version ?? row.latestVersion),
      ),
    );
  if (!v) throw new DomainError("NOT_FOUND", "Role profile version not found");
  return {
    snapshot: { profileId, version: v.version, contentHash: v.contentHash, content: v.content as unknown as RoleProfileContent },
    visibility: row.visibility,
    editable: row.ownerUserId === ctx.userId,
  };
}

/**
 * The snapshots a council stores for the chosen profiles (#270): at most one profile per role, each frozen at its
 * current version. Refused when a profile is not visible or two profiles target the same role.
 */
export async function snapshotRoleProfiles(db: Database, ctx: ActorContext, profileIds: readonly string[]): Promise<RoleProfileSessionSnapshot[]> {
  const snapshots: RoleProfileSessionSnapshot[] = [];
  for (const id of new Set(profileIds)) snapshots.push((await getRoleProfile(db, ctx, id)).snapshot);
  const roles = snapshots.map((s) => s.content.role);
  if (new Set(roles).size !== roles.length) throw new DomainError("VALIDATION", "Choose at most one role profile per role");
  return snapshots;
}

function assertCanShare(ctx: ActorContext) {
  // Sharing makes a profile part of every member's council setup – an admin or owner decides that (#270).
  if (!can(ctx.role, "member:manage")) throw new DomainError("FORBIDDEN", "Only an admin or owner can share a role profile with the team");
}

/** Creates a profile (version 1). New profiles are private unless `visibility: "team"` is asked for and allowed. */
export async function createRoleProfile(db: Database, ctx: ActorContext, input: { content: unknown; visibility?: RoleProfileVisibility }) {
  assertCan(ctx.role, "project:write");
  const { content, ignoredFields } = checked(input.content);
  const visibility = input.visibility ?? "private";
  if (visibility !== "private" && visibility !== "team") throw new DomainError("VALIDATION", "visibility must be private or team");
  if (visibility === "team") assertCanShare(ctx);
  const id = newId("rpf");
  const contentHash = roleProfileContentHash(content);
  await db.transaction(async (tx) => {
    await tx.insert(roleProfile).values({
      id,
      organizationId: ctx.organizationId,
      ownerUserId: ctx.userId,
      role: content.role,
      name: content.name,
      visibility,
      latestVersion: 1,
    });
    await tx.insert(roleProfileVersion).values({
      id: newId("rpv"),
      profileId: id,
      organizationId: ctx.organizationId,
      version: 1,
      content: content as unknown as Record<string, unknown>,
      contentHash,
      createdById: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "role_profile.created",
      targetType: "role_profile",
      targetId: id,
      metadata: { role: content.role, visibility, contentHash },
    });
  });
  return { id, version: 1, contentHash, ignoredFields };
}

async function ownProfile(db: Database, ctx: ActorContext, profileId: string) {
  const [row] = await db
    .select()
    .from(roleProfile)
    .where(and(eq(roleProfile.id, profileId), eq(roleProfile.organizationId, ctx.organizationId), isNull(roleProfile.archivedAt)));
  // Same answer for "not there" and "not yours": a private profile of someone else is invisible.
  if (!row || (row.ownerUserId !== ctx.userId && row.visibility !== "team")) throw new DomainError("NOT_FOUND", "Role profile not found");
  if (row.ownerUserId !== ctx.userId) throw new DomainError("FORBIDDEN", "Only the author can change this role profile");
  return row;
}

/** Saves changed content as a new immutable version (author only). Identical content creates no version. */
export async function saveRoleProfileVersion(db: Database, ctx: ActorContext, profileId: string, input: { content: unknown }) {
  assertCan(ctx.role, "project:write");
  if (curatedRoleProfile(profileId)) throw new DomainError("FORBIDDEN", "Curated role profiles are read-only");
  const row = await ownProfile(db, ctx, profileId);
  const { content, ignoredFields } = checked(input.content);
  const contentHash = roleProfileContentHash(content);
  const [latest] = await db
    .select()
    .from(roleProfileVersion)
    .where(and(eq(roleProfileVersion.profileId, profileId), eq(roleProfileVersion.version, row.latestVersion)));
  if (latest?.contentHash === contentHash) return { id: profileId, version: row.latestVersion, contentHash, unchanged: true, ignoredFields };
  const version = row.latestVersion + 1;
  await db.transaction(async (tx) => {
    await tx.insert(roleProfileVersion).values({
      id: newId("rpv"),
      profileId,
      organizationId: ctx.organizationId,
      version,
      content: content as unknown as Record<string, unknown>,
      contentHash,
      createdById: ctx.userId,
    });
    await tx.update(roleProfile).set({ role: content.role, name: content.name, latestVersion: version }).where(eq(roleProfile.id, profileId));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "role_profile.version_saved",
      targetType: "role_profile",
      targetId: profileId,
      metadata: { version, contentHash },
    });
  });
  return { id: profileId, version, contentHash, unchanged: false, ignoredFields };
}

/** Private ↔ team (author only; sharing with the team needs an admin or owner). */
export async function setRoleProfileVisibility(db: Database, ctx: ActorContext, profileId: string, visibility: RoleProfileVisibility) {
  assertCan(ctx.role, "project:write");
  if (visibility !== "private" && visibility !== "team") throw new DomainError("VALIDATION", "visibility must be private or team");
  const row = await ownProfile(db, ctx, profileId);
  if (visibility === "team" && row.visibility !== "team") assertCanShare(ctx);
  await db.update(roleProfile).set({ visibility }).where(eq(roleProfile.id, profileId));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "role_profile.visibility_changed",
    targetType: "role_profile",
    targetId: profileId,
    metadata: { visibility },
  });
}

/** Deactivates a profile (author only): no longer offered; versions stay for the councils that used them. */
export async function archiveRoleProfile(db: Database, ctx: ActorContext, profileId: string) {
  assertCan(ctx.role, "project:write");
  await ownProfile(db, ctx, profileId);
  await db.update(roleProfile).set({ archivedAt: new Date() }).where(eq(roleProfile.id, profileId));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "role_profile.archived",
    targetType: "role_profile",
    targetId: profileId,
  });
}
