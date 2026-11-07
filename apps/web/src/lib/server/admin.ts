import "server-only";
import { DomainError } from "@consyrion/core";
import { resolvePlatformAdmin } from "@consyrion/db";
import { requireUser } from "./actor";
import { getDb } from "./db";
import { emailVerificationEnabled } from "./email-verification";

/** The configured platform administrators (PLATFORM_ADMIN_EMAILS, comma-separated), lower case. */
export function platformAdminEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Options for `resolvePlatformAdmin`: a verified address is required whenever the server verifies addresses. */
export function platformAdminOptions(env: Record<string, string | undefined> = process.env) {
  return { requireVerifiedEmail: emailVerificationEnabled(env) };
}

/**
 * Platform administrators are configured by e-mail (PLATFORM_ADMIN_EMAILS). When e-mail verification is on (SMTP
 * configured) the address must be verified too; otherwise anyone could register an unclaimed admin address.
 */
export function isPlatformAdmin(
  user: { email: string; emailVerified?: boolean | null } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!user?.email) return false;
  if (!platformAdminEmails(env).includes(user.email.toLowerCase())) return false;
  return !platformAdminOptions(env).requireVerifiedEmail || user.emailVerified === true;
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) throw new DomainError("NOT_FOUND", "Not found");
  return user;
}

/** Admin context for repositories that check platform admin themselves (feedback inbox, #295). */
export async function requirePlatformAdminContext() {
  const user = await requireUser();
  return resolvePlatformAdmin(await getDb(), user.id, platformAdminEmails(), platformAdminOptions());
}
