import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "./errors";

/**
 * Envelope format for provider API keys at rest:
 *   v<keyVersion>.<iv b64url>.<auth tag b64url>.<ciphertext b64url>
 * AES-256-GCM with associated data that binds the ciphertext to its tenant and record,
 * so a ciphertext copied into another organization's row fails to decrypt.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface Keyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface CredentialContext {
  organizationId: string;
  credentialId: string;
}

export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^CREDENTIALS_MASTER_KEY_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
      throw new DomainError("CONFIGURATION", `${name} must be ${KEY_BYTES} bytes encoded as base64`);
    }
    keys.set(Number(match[1]), key);
  }
  const activeVersion = Number(env.CREDENTIALS_ACTIVE_KEY_VERSION ?? "1");
  if (!keys.has(activeVersion)) {
    throw new DomainError(
      "CONFIGURATION",
      `CREDENTIALS_MASTER_KEY_V${activeVersion} is not set; provider keys cannot be stored`,
    );
  }
  return { activeVersion, keys };
}

/**
 * Additional authenticated data of every stored provider key. The literal "consyrion:credential:" is part of the
 * ciphertexts already in the database – it must NEVER follow a product rename, or no stored key can be decrypted.
 */
function aad(context: CredentialContext): Buffer {
  return Buffer.from(`consyrion:credential:${context.organizationId}:${context.credentialId}`, "utf8");
}

export function encryptSecret(plaintext: string, context: CredentialContext, keyring: Keyring): string {
  if (!plaintext) throw new DomainError("VALIDATION", "Secret must not be empty");
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new DomainError("CONFIGURATION", "Active credential key is missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${keyring.activeVersion}`, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, context: CredentialContext, keyring: Keyring): string {
  const parts = envelope.split(".");
  const [versionPart, ivPart, tagPart, dataPart] = parts;
  if (parts.length !== 4 || !versionPart || !ivPart || !tagPart || dataPart === undefined || !/^v\d+$/.test(versionPart)) {
    throw new DomainError("VALIDATION", "Malformed credential envelope");
  }
  const key = keyring.keys.get(Number(versionPart.slice(1)));
  if (!key) throw new DomainError("CONFIGURATION", `Credential key ${versionPart} is not configured`);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new DomainError("FORBIDDEN", "Credential could not be decrypted for this context");
  }
}

/** Returns the key version an envelope was written with, for rotation jobs. */
export function envelopeKeyVersion(envelope: string): number | null {
  const match = /^v(\d+)\./.exec(envelope);
  return match ? Number(match[1]) : null;
}

/** Display hint that never reveals more than the last four characters. */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  return secret.length <= 8 ? "••••" : `••••${tail}`;
}
