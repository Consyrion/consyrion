import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { user } from "../schema";

/**
 * Called by Better Auth after a successful password reset (#395). The reset link was delivered to this address, so
 * the address is proven. This lets the real owner of an address that somebody else pre-registered take it back in
 * one step (new password, all other sessions revoked by Better Auth).
 */
export async function markEmailVerifiedAfterPasswordReset(db: Database, userId: string) {
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}
