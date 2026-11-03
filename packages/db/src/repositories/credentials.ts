import { assertCan, decryptSecret, DomainError, encryptSecret, maskSecret, type Keyring } from "@consyrion/core";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { aiProviderCredential } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";

export const credentialInput = z.object({
  provider: z.enum(["anthropic", "openai", "google", "deepseek", "glm", "kimi", "qwen", "xai"]),
  label: z.string().trim().min(1).max(60).default("default"),
  secret: z.string().trim().min(10, "API key looks too short").max(500),
});

/** Public projection: never includes the encrypted secret. */
const publicColumns = {
  id: aiProviderCredential.id,
  provider: aiProviderCredential.provider,
  label: aiProviderCredential.label,
  secretHint: aiProviderCredential.secretHint,
  lastValidatedAt: aiProviderCredential.lastValidatedAt,
  lastValidationError: aiProviderCredential.lastValidationError,
  createdAt: aiProviderCredential.createdAt,
};


export async function createCredential(db: Database, ctx: ActorContext, keyring: Keyring, input: z.input<typeof credentialInput>) {
  assertCan(ctx.role, "credential:write");
  const parsed = credentialInput.safeParse(input);
  if (!parsed.success) throw new DomainError("VALIDATION", "Invalid credential", z.flattenError(parsed.error));
  const { provider, label, secret } = parsed.data;
  const id = newId("cred");
  const encryptedSecret = encryptSecret(secret, { organizationId: ctx.organizationId, credentialId: id }, keyring);
  try {
    await db.insert(aiProviderCredential).values({
      id,
      organizationId: ctx.organizationId,
      provider,
      label,
      encryptedSecret,
      keyVersion: keyring.activeVersion,
      secretHint: maskSecret(secret),
      createdById: ctx.userId,
    });
  } catch (error) {
    if (String((error as { cause?: unknown })?.cause ?? error).includes("credential_org_provider_label_uq")) {
      throw new DomainError("CONFLICT", `A ${provider} key named "${label}" already exists`);
    }
    throw error;
  }
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "credential.created", targetType: "credential", targetId: id, metadata: { provider, label } });
  const [created] = await db.select(publicColumns).from(aiProviderCredential).where(eq(aiProviderCredential.id, id));
  return created!;
}

export async function listCredentials(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "credential:read");
  return db
    .select(publicColumns)
    .from(aiProviderCredential)
    .where(eq(aiProviderCredential.organizationId, ctx.organizationId))
    .orderBy(asc(aiProviderCredential.provider), asc(aiProviderCredential.label));
}

export async function deleteCredential(db: Database, ctx: ActorContext, credentialId: string) {
  assertCan(ctx.role, "credential:write");
  const deleted = await db
    .delete(aiProviderCredential)
    .where(and(eq(aiProviderCredential.id, credentialId), eq(aiProviderCredential.organizationId, ctx.organizationId)))
    .returning({ id: aiProviderCredential.id, provider: aiProviderCredential.provider });
  if (!deleted[0]) throw new DomainError("NOT_FOUND", "Credential not found");
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "credential.deleted", targetType: "credential", targetId: credentialId, metadata: { provider: deleted[0].provider } });
}

export async function recordCredentialValidation(db: Database, ctx: ActorContext, credentialId: string, error: string | null) {
  assertCan(ctx.role, "credential:read");
  await db
    .update(aiProviderCredential)
    .set({ lastValidatedAt: new Date(), lastValidationError: error })
    .where(and(eq(aiProviderCredential.id, credentialId), eq(aiProviderCredential.organizationId, ctx.organizationId)));
}

/**
 * Server-side only: decrypts a key for a provider call. The plaintext must never be returned to
 * a client, logged or stored elsewhere.
 */
export async function decryptCredentialForUse(db: Database, ctx: ActorContext, keyring: Keyring, credentialId: string) {
  assertCan(ctx.role, "credential:read");
  const [row] = await db
    .select()
    .from(aiProviderCredential)
    .where(and(eq(aiProviderCredential.id, credentialId), eq(aiProviderCredential.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Credential not found");
  return {
    provider: row.provider,
    secret: decryptSecret(row.encryptedSecret, { organizationId: row.organizationId, credentialId: row.id }, keyring),
  };
}

/**
 * Background use by the council worker (no interactive user). The credential must belong to the
 * same organization as the session that references it.
 */
export async function decryptCredentialForOrganization(db: Database, keyring: Keyring, organizationId: string, credentialId: string) {
  const [row] = await db
    .select()
    .from(aiProviderCredential)
    .where(and(eq(aiProviderCredential.id, credentialId), eq(aiProviderCredential.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Credential not found");
  return { provider: row.provider, secret: decryptSecret(row.encryptedSecret, { organizationId, credentialId }, keyring) };
}

/** Key rotation: replaces the secret of an existing credential and resets its validation state. */
export async function rotateCredential(db: Database, ctx: ActorContext, keyring: Keyring, credentialId: string, secret: string) {
  assertCan(ctx.role, "credential:write");
  const value = secret.trim();
  if (value.length < 10 || value.length > 500) throw new DomainError("VALIDATION", "API key looks invalid");
  const updated = await db
    .update(aiProviderCredential)
    .set({
      encryptedSecret: encryptSecret(value, { organizationId: ctx.organizationId, credentialId }, keyring),
      keyVersion: keyring.activeVersion,
      secretHint: maskSecret(value),
      lastValidatedAt: null,
      lastValidationError: null,
    })
    .where(and(eq(aiProviderCredential.id, credentialId), eq(aiProviderCredential.organizationId, ctx.organizationId)))
    .returning({ provider: aiProviderCredential.provider });
  if (!updated[0]) throw new DomainError("NOT_FOUND", "Credential not found");
  await recordAudit(db, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "credential.rotated", targetType: "credential", targetId: credentialId, metadata: { provider: updated[0].provider } });
}
