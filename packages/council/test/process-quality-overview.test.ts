/** #182 PR 2 – workspace overview: recent councils with a verdict, figures only, no other workspace. */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrium/core";
import {
  createCredential,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  setSubscriptionPlan,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, runSession, workspaceProcessQuality, type SessionInput } from "../src";
import { ScriptedAdapter } from "./scripted-adapter";
import { confirmProposedRequirements } from "./confirm-requirements";

let handle: DatabaseHandle;
let actor: ActorContext;
let projectId: string;
let credentialId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  projectId = (
    await createProject(handle.db, actor, {
      name: "Clinic",
      type: "architecture",
      brief: { idea: "Design a scheduling SaaS for 120 clinics.", requirements: "Health data must stay in Germany." },
    })
  ).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, actor, projectId);
});

afterEach(async () => {
  await handle.close();
});

describe("#182 workspace process quality", () => {
  it("summarises the councils with a verdict and shows nothing to another workspace", async () => {
    expect(await workspaceProcessQuality(handle.db, actor)).toEqual({ councils: [], summary: null });
    const scores = (t: string) => (t === "Monolith" ? 9 : 6);
    const adapters = new Map(
      Object.entries({
        m1: { title: "Monolith", score: scores },
        m2: { title: "Microservices", score: scores },
        m3: { title: "Serverless", score: scores },
      }).map(([m, s]) => [m, new ScriptedAdapter(s)]),
    );
    const participants = [...adapters.keys()].map((modelId) => ({ credentialId, modelId })) as SessionInput["participants"];
    const { id } = await createSession(handle.db, actor, projectId, { mode: "independent_expert", participants, confirmBudget: true });
    await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);

    const overview = await workspaceProcessQuality(handle.db, actor);
    expect(overview.councils).toHaveLength(1);
    expect(overview.councils[0]).toMatchObject({ sessionId: id, projectName: "Clinic" });
    expect(overview.councils[0]!.quality.weight.measurable).toBe(true);
    expect(overview.summary).toMatchObject({ councils: 1, fullParticipation: 1 });
    // Figures only: no proposal text in the payload.
    expect(JSON.stringify(overview)).not.toMatch(/Monolith|Microservices/);

    await handle.db.insert(schema.user).values({ id: "u2", name: "Other", email: "x@example.test" });
    const other = await resolveActor(handle.db, "u2", (await ensurePersonalOrganization(handle.db, "u2", "Other")).id);
    expect(await workspaceProcessQuality(handle.db, other)).toEqual({ councils: [], summary: null });
  });
});
