import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { beginIdempotency, completeIdempotency, idempotencyRequestHash, IDEMPOTENCY_WINDOW_MS, releaseIdempotency } from "./idempotency";
import { ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(user).values([
    { id: "a", name: "A", email: "a@example.test" },
    { id: "b", name: "B", email: "b@example.test" },
  ]);
  alice = await resolveActor(handle.db, "a", (await ensurePersonalOrganization(handle.db, "a", "A")).id);
  bob = await resolveActor(handle.db, "b", (await ensurePersonalOrganization(handle.db, "b", "B")).id);
});
afterEach(async () => {
  await handle.close();
});

const body = idempotencyRequestHash("POST /projects/p/sessions", { mode: "independent_expert" });

describe("idempotent council start (#101)", () => {
  it("the same key and request returns the first session; another request with the key is a conflict", async () => {
    const first = await beginIdempotency(handle.db, alice, "run-1", body);
    expect(first.state).toBe("new");
    await expect(beginIdempotency(handle.db, alice, "run-1", body)).rejects.toThrow(/still being processed/);
    await completeIdempotency(handle.db, (first as { id: string }).id, "ses_1");
    expect(await beginIdempotency(handle.db, alice, "run-1", body)).toEqual({ state: "replay", sessionId: "ses_1" });
    const other = idempotencyRequestHash("POST /projects/p/sessions", { mode: "consensus" });
    await expect(beginIdempotency(handle.db, alice, "run-1", other)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keys are per user and workspace, a failed start releases the key, and an expired key can be reused", async () => {
    expect((await beginIdempotency(handle.db, bob, "run-1", body)).state).toBe("new");
    const failed = await beginIdempotency(handle.db, alice, "run-1", body);
    await releaseIdempotency(handle.db, (failed as { id: string }).id);
    const retried = await beginIdempotency(handle.db, alice, "run-1", body);
    await completeIdempotency(handle.db, (retried as { id: string }).id, "ses_old");
    const later = new Date(Date.now() + IDEMPOTENCY_WINDOW_MS + 1000);
    expect((await beginIdempotency(handle.db, alice, "run-1", body, later)).state).toBe("new");
  });

  it("validates the key", async () => {
    await expect(beginIdempotency(handle.db, alice, "", body)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(beginIdempotency(handle.db, alice, "with space", body)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
