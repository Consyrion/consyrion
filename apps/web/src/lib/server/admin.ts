import "server-only";
import { DomainError } from "@consyrium/core";
import { resolvePlatformAdmin } from "@consyrium/db";
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

/**
 * Options for `resolvePlatformAdmin`: a verified address is always required (#404). Google/GitHub sign-ins count as
 * verified; a password account is verified through the e-mail link, which needs SMTP. Only a self-hosted server without
 * SMTP may opt out explicitly with PLATFORM_ADMIN_ALLOW_UNVERIFIED=true – then the e-mail list alone decides, and
 * whoever registers an unclaimed admin address first becomes admin.
 */
export function platformAdminOptions(env: Record<string, string | undefined> = process.env) {
  const optOut = env.PLATFORM_ADMIN_ALLOW_UNVERIFIED?.trim().toLowerCase() === "true" && !emailVerificationEnabled(env);
  return { requireVerifiedEmail: !optOut };
}

/**
 * Platform administrators are configured by e-mail (PLATFORM_ADMIN_EMAILS) and need a verified address (see
 * platformAdminOptions); otherwise anyone could register an unclaimed admin address.
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
