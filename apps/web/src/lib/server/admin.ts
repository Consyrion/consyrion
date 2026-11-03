import "server-only";
import { DomainError } from "@consyrion/core";
import { requireUser } from "./actor";

/** Platform administrators are configured by e-mail (PLATFORM_ADMIN_EMAILS); verified e-mail is not required in dev. */
export function isPlatformAdmin(email: string): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) throw new DomainError("NOT_FOUND", "Not found");
  return user;
}
