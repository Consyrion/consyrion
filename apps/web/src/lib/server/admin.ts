import "server-only";
import { DomainError } from "@consyrion/core";
import { resolvePlatformAdmin } from "@consyrion/db";
import { requireUser } from "./actor";
import { getDb } from "./db";

/** The configured platform administrators (PLATFORM_ADMIN_EMAILS, comma-separated), lower case. */
export function platformAdminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Platform administrators are configured by e-mail (PLATFORM_ADMIN_EMAILS); verified e-mail is not required in dev. */
export function isPlatformAdmin(email: string): boolean {
  return platformAdminEmails().includes(email.toLowerCase());
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) throw new DomainError("NOT_FOUND", "Not found");
  return user;
}

/** Admin context for repositories that check platform admin themselves (feedback inbox, #295). */
export async function requirePlatformAdminContext() {
  const user = await requireUser();
  return resolvePlatformAdmin(await getDb(), user.id, platformAdminEmails());
}
