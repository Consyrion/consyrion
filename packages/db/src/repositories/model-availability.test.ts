import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { recentlyUnavailableModels, recordModelCheck } from "./model-availability";
import { createOrganization, ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  alice = await resolveActor(handle.db, "alice", (await ensurePersonalOrganization(handle.db, "alice", "Alice")).id);
  bob = await resolveActor(handle.db, "bob", (await createOrganization(handle.db, "bob", { name: "Bob Inc" })).id);
});

afterAll(async () => {
  await handle.close();
});

const notFound = { ok: false, inputTokens: 0, outputTokens: 0, durationMs: 120, errorKind: "model_not_found", httpStatus: 404 } as const;
const answered = { ok: true, inputTokens: 8, outputTokens: 2, durationMs: 300 } as const;

describe("model availability hints", () => {
  it("lists a model whose latest call ended with 'model not found', only in its own workspace", async () => {
    await recordModelCheck(handle.db, alice, { provider: "google", modelId: "gemini-2.5-pro", ...notFound });
    const hints = await recentlyUnavailableModels(handle.db, alice);
    expect(hints).toEqual([{ provider: "google", modelId: "gemini-2.5-pro", at: expect.any(Date) }]);
    expect(await recentlyUnavailableModels(handle.db, bob)).toEqual([]);
  });

  it("clears the hint as soon as the model answers again", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordModelCheck(handle.db, alice, { provider: "google", modelId: "Gemini-2.5-Pro", ...answered });
    expect(await recentlyUnavailableModels(handle.db, alice)).toEqual([]);
  });

  it("expires on its own after 24 hours – nothing stays blocked", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordModelCheck(handle.db, alice, { provider: "openai", modelId: "gpt-retired", ...notFound });
    expect((await recentlyUnavailableModels(handle.db, alice)).map((h) => h.modelId)).toEqual(["gpt-retired"]);
    const tomorrow = new Date(Date.now() + 25 * 3_600_000);
    expect(await recentlyUnavailableModels(handle.db, alice, tomorrow)).toEqual([]);
  });

  it("other failures (rate limit, timeout) do not mark a model as unavailable", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordModelCheck(handle.db, alice, {
      provider: "anthropic",
      modelId: "claude-x",
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 50,
      errorKind: "rate_limit",
    });
    expect((await recentlyUnavailableModels(handle.db, alice)).map((h) => h.modelId)).not.toContain("claude-x");
  });
});
