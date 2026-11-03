import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { apiToken, membership, user } from "../schema";
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken } from "./api-tokens";
import { resolveActor, type ActorContext } from "./context";
import { ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let actor: ActorContext;

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values({ id: "u", name: "U", email: "u@example.test" });
  actor = await resolveActor(handle.db, "u", (await ensurePersonalOrganization(handle.db, "u", "U")).id);
});
afterEach(async () => {
  await handle.close();
});

describe("API tokens", () => {
  it("stores only a hash and resolves the token to user and workspace", async () => {
    const { token } = await createApiToken(handle.db, actor, { name: "VS Code", days: 30, scope: "full" });
    expect(token).toMatch(/^cns_/);
    const [row] = await handle.db.select().from(apiToken);
    expect(row!.tokenHash).not.toContain(token);
    expect(JSON.stringify(await listApiTokens(handle.db, actor))).not.toContain(token.slice(10));
    expect(await resolveApiToken(handle.db, token)).toEqual({ userId: "u", organizationId: actor.organizationId, scope: "full" });
  });

  it("rejects revoked, expired and unknown tokens; membership is still required", async () => {
    const { id, token } = await createApiToken(handle.db, actor, { name: "t", days: 1 });
    await expect(resolveApiToken(handle.db, "cns_unknown")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await handle.db.update(apiToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiToken.id, id));
    await expect(resolveApiToken(handle.db, token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const second = await createApiToken(handle.db, actor, { name: "t2", days: 1 });
    await revokeApiToken(handle.db, actor, second.id);
    await expect(resolveApiToken(handle.db, second.token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const third = await createApiToken(handle.db, actor, { name: "t3", days: 1 });
    const resolved = await resolveApiToken(handle.db, third.token);
    await handle.db.delete(membership).where(eq(membership.userId, "u"));
    await expect(resolveActor(handle.db, resolved.userId, resolved.organizationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("#101: a new token is an integration token (cni_) unless full access is chosen", async () => {
    const integration = await createApiToken(handle.db, actor, { name: "Obsidian", days: 30 });
    expect(integration.token).toMatch(/^cni_/);
    expect(await resolveApiToken(handle.db, integration.token)).toMatchObject({ scope: "integration" });
    expect((await listApiTokens(handle.db, actor))[0]).toMatchObject({ name: "Obsidian", scope: "integration" });
  });

  it("#101: prefix and stored scope must agree – a changed prefix or a widened stored scope never resolves", async () => {
    const { id, token } = await createApiToken(handle.db, actor, { name: "i", days: 30 });
    await expect(resolveApiToken(handle.db, `cns_${token.slice(4)}`)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await handle.db.update(apiToken).set({ scope: "full" }).where(eq(apiToken.id, id));
    await expect(resolveApiToken(handle.db, token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await handle.db.update(apiToken).set({ scope: "admin" }).where(eq(apiToken.id, id));
    await expect(resolveApiToken(handle.db, token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("validates input", async () => {
    await expect(createApiToken(handle.db, actor, { name: "x", days: 30, scope: "admin" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createApiToken(handle.db, actor, { name: "", days: 30 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createApiToken(handle.db, actor, { name: "x", days: 400 })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
