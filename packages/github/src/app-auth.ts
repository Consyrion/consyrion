import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { DomainError } from "@consyrium/core";

export interface GitHubAppConfig {
  appId: string;
  /** PEM private key of the GitHub App. */
  privateKey: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

export function githubAppConfigFromEnv(env: Record<string, string | undefined> = process.env): GitHubAppConfig | null {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_WEBHOOK_SECRET } = env;
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_SLUG || !GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET || !GITHUB_APP_WEBHOOK_SECRET) return null;
  return {
    appId: GITHUB_APP_ID,
    // Allows storing the key in one env line with literal "\n".
    privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    slug: GITHUB_APP_SLUG,
    clientId: GITHUB_APP_CLIENT_ID,
    clientSecret: GITHUB_APP_CLIENT_SECRET,
    webhookSecret: GITHUB_APP_WEBHOOK_SECRET,
  };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** App JWT (RS256, ≤ 10 min) used only to mint short-lived installation tokens. */
export function createAppJwt(config: Pick<GitHubAppConfig, "appId" | "privateKey">, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(config.privateKey))}`;
}

/** Verifies the X-Hub-Signature-256 header of a webhook delivery in constant time. */
export function verifyWebhookSignature(secret: string, body: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(signatureHeader);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Signed, expiring state for the installation round trip. It binds the callback to the
 * organization and user that started it (CSRF protection).
 */
export function signState(secret: string, data: { organizationId: string; userId: string }, now = Date.now()): string {
  const payload = b64url(JSON.stringify({ ...data, exp: now + 15 * 60_000 }));
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyState(secret: string, state: string | null, now = Date.now()): { organizationId: string; userId: string } {
  const [payload, signature] = (state ?? "").split(".");
  if (!payload || !signature) throw new DomainError("VALIDATION", "Missing state");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new DomainError("FORBIDDEN", "Invalid state");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { organizationId: string; userId: string; exp: number };
  if (data.exp < now) throw new DomainError("FORBIDDEN", "The GitHub connection link expired; start again");
  return { organizationId: data.organizationId, userId: data.userId };
}
