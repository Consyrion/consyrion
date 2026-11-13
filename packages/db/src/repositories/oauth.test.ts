import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { apiToken, auditEvent, membership, oauthClient, oauthCode, user } from "../schema";
import { listApiTokens, resolveApiToken } from "./api-tokens";
import { resolveActor, type ActorContext } from "./context";
import { createAuthorizationCode, exchangeAuthorizationCode, getClient, OAUTH_TOKEN_DAYS, OBSIDIAN_CLIENT_ID, registerClient } from "./oauth";
import { ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let actor: ActorContext;

const REDIRECT = "http://localhost:53682/callback";
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values({ id: "u", name: "U", email: "u@example.test" });
  actor = await resolveActor(handle.db, "u", (await ensurePersonalOrganization(handle.db, "u", "U")).id);
});
afterEach(async () => {
  await handle.close();
});

/** Registers a client and lets the user allow it; returns what the client holds before the exchange. */
async function authorize(scope: "integration" | "read" = "integration") {
  const client = await registerClient(handle.db, { name: "Claude Code", redirectUris: [REDIRECT, "https://example.com/cb"] });
  const { verifier, challenge } = pkce();
  const { code } = await createAuthorizationCode(handle.db, actor, { clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: challenge, scope });
  return { client, code, verifier };
}

describe("OAuth clients", () => {
  it("registers a public client with a random id and validated redirect URIs", async () => {
    const a = await registerClient(handle.db, { name: "  Claude Code ", redirectUris: [REDIRECT] });
    const b = await registerClient(handle.db, { name: "Claude Code", redirectUris: [REDIRECT] });
    expect(a.clientId).toMatch(/^cnc_[A-Za-z0-9_-]{24}$/);
    expect(a.clientId).not.toBe(b.clientId);
    expect(a).toMatchObject({ name: "Claude Code", redirectUris: [REDIRECT], firstParty: false });
    expect(await getClient(handle.db, a.clientId)).toEqual(a);
    expect(await getClient(handle.db, "cnc_unknown")).toBeNull();
    // Without a name the client is called by the host it redirects to.
    expect((await registerClient(handle.db, { name: undefined, redirectUris: ["https://example.com/cb"] })).name).toBe("https://example.com");
  });

  it("refuses bad redirect URIs and names", async () => {
    for (const redirectUris of [[], ["javascript:alert(1)"], ["http://example.com/cb"], ["obsidian://open"], "https://example.com/cb", undefined])
      await expect(registerClient(handle.db, { name: "x", redirectUris })).rejects.toMatchObject({ error: "invalid_redirect_uri" });
    await expect(registerClient(handle.db, { name: "x".repeat(81), redirectUris: [REDIRECT] })).rejects.toMatchObject({ error: "invalid_client_metadata" });
    await expect(registerClient(handle.db, { name: 7, redirectUris: [REDIRECT] })).rejects.toMatchObject({ error: "invalid_client_metadata" });
    expect(await handle.db.select().from(oauthClient)).toHaveLength(0);
  });

  it("knows the Obsidian plugin without a database row, with exactly one redirect URI", async () => {
    expect(await getClient(handle.db, OBSIDIAN_CLIENT_ID)).toEqual({
      clientId: "consyrium-obsidian",
      name: "CONSYRIUM AI for Obsidian",
      redirectUris: ["obsidian://consyrium-auth"],
      firstParty: true,
    });
    expect(await handle.db.select().from(oauthClient)).toHaveLength(0);
  });

  it("drops a stored redirect URI that the rules no longer allow", async () => {
    const client = await registerClient(handle.db, { name: "x", redirectUris: [REDIRECT] });
    await handle.db
      .update(oauthClient)
      .set({ redirectUris: [REDIRECT, "http://evil.example/cb"] })
      .where(eq(oauthClient.clientId, client.clientId));
    expect((await getClient(handle.db, client.clientId))!.redirectUris).toEqual([REDIRECT]);
  });
});

describe("OAuth authorization code", () => {
  it("register → authorize → exchange gives an integration token that resolveApiToken accepts", async () => {
    const { client, code, verifier } = await authorize();
    const [stored] = await handle.db.select().from(oauthCode);
    expect(stored!.codeHash).not.toContain(code);
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(100_000);

    const result = await exchangeAuthorizationCode(handle.db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier });
    expect(result.token).toMatch(/^cni_/);
    expect(result).toMatchObject({ scope: "integration", expiresIn: OAUTH_TOKEN_DAYS * 86_400 });
    expect(await resolveApiToken(handle.db, result.token)).toEqual({ userId: "u", organizationId: actor.organizationId, scope: "integration" });

    // An ordinary token row: listed (and revocable) under Settings → API tokens, valid 90 days.
    const [listed] = await listApiTokens(handle.db, actor);
    expect(listed).toMatchObject({ name: "Connected: Claude Code", scope: "integration" });
    expect(Math.round((listed!.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(90);

    const audit = await handle.db.select().from(auditEvent);
    expect(audit.find((a) => a.action === "oauth.authorized")).toMatchObject({
      actorUserId: "u",
      organizationId: actor.organizationId,
      targetId: client.clientId,
      metadata: { clientName: "Claude Code", firstParty: false, redirectTarget: "http://localhost:53682", scope: "integration" },
    });
    expect(audit.find((a) => a.action === "api_token.created")).toMatchObject({
      metadata: { scope: "integration", days: 90, via: `oauth:${client.clientId}` },
    });
    expect(JSON.stringify(audit)).not.toContain(code);
    expect(JSON.stringify(audit)).not.toContain(result.token.slice(10));
  });

  it("the read scope gives a read-only token", async () => {
    const { client, code, verifier } = await authorize("read");
    const result = await exchangeAuthorizationCode(handle.db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier });
    expect(result.token).toMatch(/^cnr_/);
    expect(await resolveApiToken(handle.db, result.token)).toMatchObject({ scope: "read" });
  });

  it("the Obsidian plugin connects without registration", async () => {
    const { verifier, challenge } = pkce();
    const { code } = await createAuthorizationCode(handle.db, actor, {
      clientId: OBSIDIAN_CLIENT_ID,
      redirectUri: "obsidian://consyrium-auth",
      codeChallenge: challenge,
      scope: "integration",
    });
    const result = await exchangeAuthorizationCode(handle.db, {
      code,
      clientId: OBSIDIAN_CLIENT_ID,
      redirectUri: "obsidian://consyrium-auth",
      codeVerifier: verifier,
    });
    expect(await resolveApiToken(handle.db, result.token)).toMatchObject({ scope: "integration" });
    expect((await listApiTokens(handle.db, actor))[0]!.name).toBe("Connected: CONSYRIUM AI for Obsidian");
  });

  it("a code works once – a replay fails and creates no second token", async () => {
    const { client, code, verifier } = await authorize();
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    await exchangeAuthorizationCode(handle.db, input);
    await expect(exchangeAuthorizationCode(handle.db, input)).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await handle.db.select().from(apiToken)).toHaveLength(1);
  });

  it("two parallel exchanges of the same code give exactly one token", async () => {
    const { client, code, verifier } = await authorize();
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    const results = await Promise.allSettled([exchangeAuthorizationCode(handle.db, input), exchangeAuthorizationCode(handle.db, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await handle.db.select().from(apiToken)).toHaveLength(1);
  });

  it("a wrong verifier fails AND burns the code – the right verifier no longer works afterwards", async () => {
    const { client, code, verifier } = await authorize();
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT };
    await expect(exchangeAuthorizationCode(handle.db, { ...input, codeVerifier: pkce().verifier })).rejects.toMatchObject({ error: "invalid_grant" });
    expect((await handle.db.select().from(oauthCode))[0]!.usedAt).not.toBeNull();
    await expect(exchangeAuthorizationCode(handle.db, { ...input, codeVerifier: verifier })).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await handle.db.select().from(apiToken)).toHaveLength(0);
  });

  it("a missing or malformed verifier fails; the challenge itself is not a verifier", async () => {
    for (const codeVerifier of [undefined, "", "short", 42]) {
      const { client, code } = await authorize();
      await expect(exchangeAuthorizationCode(handle.db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier })).rejects.toMatchObject({
        error: "invalid_grant",
      });
    }
    const { client, code } = await authorize();
    const [stored] = (await handle.db.select().from(oauthCode)).filter((c) => c.usedAt === null);
    await expect(
      exchangeAuthorizationCode(handle.db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: stored!.codeChallenge }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await handle.db.select().from(apiToken)).toHaveLength(0);
  });

  it("a wrong redirect URI or another client fails with the same error and burns the code", async () => {
    const first = await authorize();
    await expect(
      exchangeAuthorizationCode(handle.db, {
        code: first.code,
        clientId: first.client.clientId,
        redirectUri: "https://example.com/cb",
        codeVerifier: first.verifier,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(
      exchangeAuthorizationCode(handle.db, { code: first.code, clientId: first.client.clientId, redirectUri: REDIRECT, codeVerifier: first.verifier }),
    ).rejects.toMatchObject({ error: "invalid_grant" });

    const second = await authorize();
    const other = await registerClient(handle.db, { name: "Other", redirectUris: [REDIRECT] });
    await expect(
      exchangeAuthorizationCode(handle.db, { code: second.code, clientId: other.clientId, redirectUri: REDIRECT, codeVerifier: second.verifier }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(
      exchangeAuthorizationCode(handle.db, { code: second.code, clientId: second.client.clientId, redirectUri: REDIRECT, codeVerifier: second.verifier }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await handle.db.select().from(apiToken)).toHaveLength(0);
  });

  it("an expired or unknown code fails", async () => {
    const { client, code, verifier } = await authorize();
    await handle.db.update(oauthCode).set({ expiresAt: new Date(Date.now() - 1000) });
    const input = { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier };
    await expect(exchangeAuthorizationCode(handle.db, input)).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(exchangeAuthorizationCode(handle.db, { ...input, code: "unknown" })).rejects.toMatchObject({ error: "invalid_grant" });
    await expect(exchangeAuthorizationCode(handle.db, { ...input, code: undefined })).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await handle.db.select().from(apiToken)).toHaveLength(0);
  });

  it("no token when the user left the workspace between consent and exchange", async () => {
    const { client, code, verifier } = await authorize();
    await handle.db.delete(membership).where(eq(membership.userId, "u"));
    await expect(
      exchangeAuthorizationCode(handle.db, { code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: verifier }),
    ).rejects.toMatchObject({
      error: "invalid_grant",
    });
    expect(await handle.db.select().from(apiToken)).toHaveLength(0);
  });

  it("re-validates the request when the code is created – the consent page is not trusted", async () => {
    const client = await registerClient(handle.db, { name: "x", redirectUris: [REDIRECT] });
    const { challenge } = pkce();
    const base = { clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: challenge, scope: "integration" as const };
    await expect(createAuthorizationCode(handle.db, actor, { ...base, clientId: "cnc_unknown" })).rejects.toMatchObject({ code: "VALIDATION" });
    // Not registered for this client – also not when only the path or the port differs.
    for (const redirectUri of ["https://example.com/cb", "http://localhost:53682/callback/", "http://localhost:53683/callback", "obsidian://consyrium-auth"])
      await expect(createAuthorizationCode(handle.db, actor, { ...base, redirectUri })).rejects.toMatchObject({ code: "VALIDATION" });
    for (const codeChallenge of ["", "plain-verifier", `${challenge}=`])
      await expect(createAuthorizationCode(handle.db, actor, { ...base, codeChallenge })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createAuthorizationCode(handle.db, actor, { ...base, scope: "full" as never })).rejects.toMatchObject({ code: "VALIDATION" });
    // The Obsidian client cannot be used with any other redirect URI.
    await expect(createAuthorizationCode(handle.db, actor, { ...base, clientId: OBSIDIAN_CLIENT_ID })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await handle.db.select().from(oauthCode)).toHaveLength(0);
  });

  it("removes long-expired codes when a new one is created", async () => {
    await authorize();
    await handle.db.update(oauthCode).set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) });
    await authorize();
    expect(await handle.db.select().from(oauthCode)).toHaveLength(1);
  });
});
