import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, envelopeKeyVersion, keyringFromEnv, maskSecret, type Keyring } from "./crypto";
import { DomainError } from "./errors";

const key = () => randomBytes(32).toString("base64");
const context = { organizationId: "org_a", credentialId: "cred_1" };

function keyring(env: Record<string, string>): Keyring {
  return keyringFromEnv(env);
}

describe("credential encryption", () => {
  it("round-trips a secret", () => {
    const ring = keyring({ CREDENTIALS_MASTER_KEY_V1: key() });
    const envelope = encryptSecret("sk-test-123456789", context, ring);
    expect(envelope).not.toContain("sk-test");
    expect(decryptSecret(envelope, context, ring)).toBe("sk-test-123456789");
  });

  it("uses a fresh IV for every encryption", () => {
    const ring = keyring({ CREDENTIALS_MASTER_KEY_V1: key() });
    expect(encryptSecret("same", context, ring)).not.toBe(encryptSecret("same", context, ring));
  });

  it("rejects a ciphertext moved to another organization or record", () => {
    const ring = keyring({ CREDENTIALS_MASTER_KEY_V1: key() });
    const envelope = encryptSecret("secret", context, ring);
    expect(() => decryptSecret(envelope, { ...context, organizationId: "org_b" }, ring)).toThrow(DomainError);
    expect(() => decryptSecret(envelope, { ...context, credentialId: "cred_2" }, ring)).toThrow(DomainError);
  });

  it("detects tampering", () => {
    const ring = keyring({ CREDENTIALS_MASTER_KEY_V1: key() });
    const [v, iv, tag, data] = encryptSecret("secret-value", context, ring).split(".");
    const flipped = Buffer.from(data!, "base64url");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), context, ring)).toThrow(DomainError);
  });

  it("decrypts envelopes written with an older key after rotation", () => {
    const v1 = key();
    const old = keyring({ CREDENTIALS_MASTER_KEY_V1: v1 });
    const envelope = encryptSecret("rotate-me", context, old);
    const rotated = keyring({ CREDENTIALS_MASTER_KEY_V1: v1, CREDENTIALS_MASTER_KEY_V2: key(), CREDENTIALS_ACTIVE_KEY_VERSION: "2" });
    expect(decryptSecret(envelope, context, rotated)).toBe("rotate-me");
    expect(envelopeKeyVersion(encryptSecret("new", context, rotated))).toBe(2);
  });

  it("refuses misconfigured keyrings", () => {
    expect(() => keyringFromEnv({})).toThrow(/not set/);
    expect(() => keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: Buffer.from("short").toString("base64") })).toThrow(/32 bytes/);
  });

  it("rejects malformed envelopes", () => {
    const ring = keyring({ CREDENTIALS_MASTER_KEY_V1: key() });
    expect(() => decryptSecret("garbage", context, ring)).toThrow(/Malformed/);
    expect(() => decryptSecret("v9.a.b.c", context, ring)).toThrow(/not configured/);
  });

  it("masks secrets", () => {
    expect(maskSecret("sk-ant-abcdefgh1234")).toBe("••••1234");
    expect(maskSecret("short")).toBe("••••");
  });
});
