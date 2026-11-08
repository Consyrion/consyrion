import { randomBytes } from "node:crypto";
import { coverAllParticipants, keyringFromEnv } from "@consyrion/core";
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
} from "@consyrion/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, getSessionView, previewSession, runSession } from "../src";
import { confirmProposedRequirements } from "./confirm-requirements";
import { ScriptedAdapter } from "./scripted-adapter";

let handle: DatabaseHandle;
let actor: ActorContext;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
});

afterEach(async () => {
  await handle.close();
});

describe("every model gets a perspective (#136)", () => {
  it("adds roles for models without one, generalists first, and keeps explicit assignments", () => {
    const four = ["software_architect", "security_expert", "cost_analyst", "independent_critical_thinker"] as const;
    const six = coverAllParticipants(four, 6);
    expect(six.added).toEqual([
      { role: "maintainability_reviewer", participantIndex: 4 },
      { role: "quality_assurance_expert", participantIndex: 5 },
    ]);
    // All roles on model 0: the other five get one each.
    const allOnOne = coverAllParticipants(
      four,
      6,
      four.map((role) => ({ role, participantIndex: 0 })),
    );
    expect(new Set(allOnOne.assignments.map((a) => a.participantIndex))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(coverAllParticipants(four, 3).added).toEqual([]);
  });

  it("six models and four default roles: every model writes its own 12 Minds review and preference", async () => {
    const projectId = (
      await createProject(handle.db, actor, {
        name: "Six",
        type: "architecture",
        brief: { idea: "Pick a queue for a small team.", requirements: "Must run on one server." },
      })
    ).id;
    await confirmProposedRequirements(handle.db, actor, projectId);
    const credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const adapters = new Map(ids.map((id, i) => [id, new ScriptedAdapter({ title: `Option ${i + 1}`, score: () => 7 })]));
    const input = {
      mode: "independent_expert" as const,
      participants: ids.map((modelId) => ({ credentialId, modelId })),
      roles: ["software_architect", "security_expert", "cost_analyst", "independent_critical_thinker"] as Array<"software_architect">,
      tokenBudget: 5_000_000,
      confirmBudget: true,
    };
    const preview = await previewSession(handle.db, actor, projectId, input);
    expect(preview.addedRoles).toHaveLength(2);
    // Switched off (ChatGPT review): no extra perspectives, the chosen roles only.
    const off = await previewSession(handle.db, actor, projectId, { ...input, extraRoles: false });
    expect(off.addedRoles).toEqual([]);
    expect(off.policy.roles).toHaveLength(4);
    expect(off.estimate.upperBound).toBeLessThan(preview.estimate.upperBound);
    const { id } = await createSession(handle.db, actor, projectId, input);
    await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
    const view = await getSessionView(handle.db, actor, id);
    const withRole = new Set(view.roles.map((r) => r.participantId));
    expect(withRole.size).toBe(6);
    const reviewed = new Set(view.messages.filter((m) => m.phase === "twelve_minds_council" && m.kind === "preference").map((m) => m.participantId));
    expect(reviewed.size).toBe(6);
  }, 60_000);
});
