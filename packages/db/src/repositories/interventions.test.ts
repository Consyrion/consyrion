import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../client";
import { councilParticipant, councilSession, membership, projectBrief, usageRecord, user } from "../schema";
import { resolveActor, type ActorContext } from "./context";
import { addInterventionAnswer, createIntervention, interventionCredentials, listInterventions, toggleInterventionMark } from "./interventions";
import { createOrganization, ensurePersonalOrganization } from "./organizations";
import { archiveProject, createProject } from "./projects";

let handle: DatabaseHandle;
let owner: ActorContext;
let viewer: ActorContext;
let other: ActorContext;
let projectId: string;

async function session(id: string, status: "running" | "awaiting_approval") {
  const [b] = await handle.db.select().from(projectBrief).where(eq(projectBrief.projectId, projectId));
  await handle.db.insert(councilSession).values({
    id,
    organizationId: owner.organizationId,
    projectId,
    briefId: b!.id,
    mode: "independent_expert",
    policy: {},
    policyVersion: 1,
    tokenBudget: 100_000,
    status,
    createdById: "owner",
  });
  await handle.db.insert(councilParticipant).values({
    id: `par_${id}`,
    organizationId: owner.organizationId,
    sessionId: id,
    provider: "anthropic",
    modelId: "model-a",
    credentialId: null,
    position: 0,
  });
}

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["owner", "vic", "bob"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  const org = await ensurePersonalOrganization(handle.db, "owner", "Owner");
  await handle.db.insert(membership).values({ id: "mem_vic", organizationId: org.id, userId: "vic", role: "viewer" });
  owner = await resolveActor(handle.db, "owner", org.id);
  viewer = await resolveActor(handle.db, "vic", org.id);
  other = await resolveActor(handle.db, "bob", (await createOrganization(handle.db, "bob", { name: "Bob Inc" })).id);
  projectId = (await createProject(handle.db, owner, { name: "Interventions", type: "idea", brief: { idea: "Pick a database for an internal tool." } })).id;
  await session("ses_running", "running");
  await session("ses_done", "awaiting_approval");
});

afterAll(async () => {
  await handle.close();
});

describe("human interventions after the verdict (#15/#41 stage 1)", () => {
  it("are refused while the council runs, for viewers and for another workspace", async () => {
    await expect(
      createIntervention(handle.db, owner, { sessionId: "ses_running", kind: "question", targetType: "session", text: "Why?" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(createIntervention(handle.db, viewer, { sessionId: "ses_done", kind: "question", targetType: "session", text: "Why?" })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
    await expect(createIntervention(handle.db, other, { sessionId: "ses_done", kind: "question", targetType: "session", text: "Why?" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("stores a question and an answer with a usage row of kind intervention and no phase; marks toggle", async () => {
    const q = await createIntervention(handle.db, owner, { sessionId: "ses_done", kind: "question", targetType: "session", text: "Was kostet Option B?" });
    await addInterventionAnswer(handle.db, owner, {
      interventionId: q.id,
      sessionId: "ses_done",
      participantId: "par_ses_done",
      provider: "anthropic",
      modelId: "model-a",
      body: "Etwa 20 € im Monat.",
      error: null,
      outcome: "ok",
      errorKind: null,
      usage: { inputTokens: 300, outputTokens: 80 },
      durationMs: 1200,
    });
    const [row] = await handle.db.select().from(usageRecord).where(eq(usageRecord.sessionId, "ses_done"));
    expect(row).toMatchObject({ kind: "intervention", phase: null, participantId: "par_ses_done", inputTokens: 300, outputTokens: 80, outcome: "ok" });

    expect(await toggleInterventionMark(handle.db, owner, { sessionId: "ses_done", targetType: "objection", targetId: "obj_1" })).toEqual({ marked: true });
    const list = await listInterventions(handle.db, owner, "ses_done");
    expect(list.map((i) => i.kind)).toEqual(["question", "mark"]);
    expect(list[0]!.answers).toEqual([expect.objectContaining({ body: "Etwa 20 € im Monat.", modelId: "model-a" })]);
    expect(await toggleInterventionMark(handle.db, owner, { sessionId: "ses_done", targetType: "objection", targetId: "obj_1" })).toEqual({ marked: false });
    expect((await listInterventions(handle.db, owner, "ses_done")).map((i) => i.kind)).toEqual(["question"]);
    expect(await listInterventions(handle.db, other, "ses_done")).toEqual([]);
    expect((await interventionCredentials(handle.db, owner, "ses_done")).size).toBe(0); // no key on this test participant
  });

  it("is refused in an archived project", async () => {
    await archiveProject(handle.db, owner, projectId);
    await expect(
      createIntervention(handle.db, owner, { sessionId: "ses_done", kind: "question", targetType: "session", text: "Noch eine Frage" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
