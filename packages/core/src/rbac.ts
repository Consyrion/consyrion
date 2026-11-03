import { DomainError } from "./errors";

export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "org:read",
  "org:manage",
  "member:manage",
  "project:read",
  "project:write",
  "project:delete",
  "credential:read",
  "credential:write",
  "decision:run",
  "decision:approve",
  "billing:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set<Permission>([
    "org:read",
    "member:manage",
    "project:read",
    "project:write",
    "project:delete",
    "credential:read",
    "credential:write",
    "decision:run",
    "decision:approve",
    "audit:read",
  ]),
  member: new Set<Permission>(["org:read", "project:read", "project:write", "credential:read", "decision:run"]),
  viewer: new Set<Permission>(["org:read", "project:read"]),
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function assertCan(role: OrgRole | null | undefined, permission: Permission): void {
  if (!can(role, permission)) {
    throw new DomainError("FORBIDDEN", `Missing permission ${permission}`);
  }
}

/** Only owners may grant the owner role; admins can manage members below themselves. */
export function canAssignRole(actor: OrgRole, target: OrgRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}
