import { decryptSecret, encryptSecret, type Keyring } from "@consyrium/core";
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { platformSetting } from "../schema";
import { recordAudit } from "./audit";

/** Encryption context of platform secrets: not tied to a workspace. */
const context = (key: string) => ({ organizationId: "platform", credentialId: `setting:${key}` });

export interface PlatformSettingRow<T> {
  value: T;
  hasSecret: boolean;
  updatedAt: Date;
}

export async function getPlatformSetting<T extends Record<string, unknown>>(db: Database, key: string): Promise<PlatformSettingRow<T> | null> {
  const [row] = await db.select().from(platformSetting).where(eq(platformSetting.key, key));
  return row ? { value: row.value as T, hasSecret: Boolean(row.secret), updatedAt: row.updatedAt } : null;
}

/** Server-only: decrypted secret of a setting, or null. */
export async function getPlatformSecret(db: Database, key: string, keyring: Keyring): Promise<string | null> {
  const [row] = await db.select({ secret: platformSetting.secret }).from(platformSetting).where(eq(platformSetting.key, key));
  return row?.secret ? decryptSecret(row.secret, context(key), keyring) : null;
}

/** Writes a setting; `secret` undefined keeps the stored secret, null removes it. Audited without values. */
export async function setPlatformSetting(
  db: Database,
  adminUserId: string,
  key: string,
  value: Record<string, unknown>,
  secret: string | null | undefined,
  keyring: Keyring,
) {
  const envelope = secret === undefined ? undefined : secret === null ? null : encryptSecret(secret, context(key), keyring);
  await db
    .insert(platformSetting)
    .values({ key, value, secret: envelope ?? null, updatedBy: adminUserId })
    .onConflictDoUpdate({
      target: platformSetting.key,
      set: { value, updatedBy: adminUserId, updatedAt: new Date(), ...(envelope === undefined ? {} : { secret: envelope }) },
    });
  await recordAudit(db, { organizationId: null, actorUserId: adminUserId, action: "admin.setting_updated", targetType: "platform_setting", targetId: key });
}
