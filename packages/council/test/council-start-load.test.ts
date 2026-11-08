/**
 * Load test #510, scenario 6: parallel council starts (or a double click on "Start") with a tight monthly quota. The
 * monthly run is booked in the same transaction as the session under a workspace lock (#201, consumeMonthlyRun), so
 * exactly `limit − used` starts succeed and every started session is booked once. Local only: PGlite, test key.
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  getEntitlements,
  resolveActor,
  schema,
  usageThisMonth,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, type SessionInput } from "../src";
import { confirmProposedRequirements } from "./confirm-requirements";

let handle: DatabaseHandle;
let actor: ActorContext;
let projectId: string;
let participants: SessionInput["participants"];
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u_starts", name: "Owner", email: "starts@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u_starts", "Owner");
  actor = await resolveActor(handle.db, "u_starts", org.id);
  projectId = (
    await createProject(handle.db, actor, {
      name: "Load test starts",
      type: "architecture",
      brief: { idea: "Choose a database for a small internal tool.", requirements: "Running costs must not exceed 50 EUR per month." },
    })
  ).id;
  const credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  participants = ["m1", "m2"].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
  await confirmProposedRequirements(handle.db, actor, projectId);
});

afterAll(async () => {
  await handle.close();
});

const start = () => createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true });

describe("council starts under load (#510 scenario 6)", () => {
  it("parallel starts on a tight monthly quota succeed exactly limit − used times, each booked once", async () => {
    const limit = (await getEntitlements(handle.db, actor.organizationId)).entitlements.maxSessionsPerMonth;
    expect(limit).toBeGreaterThanOrEqual(2);
    // Use all but two slots one after another.
    for (let i = 0; i < limit - 2; i++) await start();
    const used = (await usageThisMonth(handle.db, actor.organizationId)).sessions;
    expect(used).toBe(limit - 2);

    // Six clicks at once (double clicks included) for the last two slots.
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => start()));
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(limit - used);
    expect(refused.every((r) => /council session\(s\) per month/.test(String(r.reason?.message)))).toBe(true);

    // The ledger holds exactly one booking per started session, and the quota is full.
    expect((await usageThisMonth(handle.db, actor.organizationId)).sessions).toBe(limit);
    const sessions = await handle.db.select({ id: schema.councilSession.id }).from(schema.councilSession).where(eq(schema.councilSession.projectId, projectId));
    expect(sessions).toHaveLength(limit);
    const bookings = await handle.db.select().from(schema.planUsage).where(eq(schema.planUsage.organizationId, actor.organizationId));
    const sessionBookings = bookings.filter((b) => b.kind === "session");
    expect(sessionBookings).toHaveLength(limit);
    expect(new Set(sessionBookings.map((b) => b.refId))).toEqual(new Set(sessions.map((s) => s.id)));
  });
});
