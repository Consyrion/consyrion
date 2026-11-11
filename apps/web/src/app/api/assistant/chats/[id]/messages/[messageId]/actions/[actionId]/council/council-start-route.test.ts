import {
  acceptActionProposals,
  addAssistantMessage,
  createAssistantChat,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrium/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
let actor: ActorContext;
let requirementsCurrent = true;
let upperBound = 120_000;
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/actor", () => ({ requireActor: async () => actor }));
vi.mock("@/lib/server/model-catalog", () => ({ modelCatalog: () => ({}) }));
vi.mock("@consyrium/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@consyrium/db")>();
  const { DomainError } = await import("@consyrium/core");
  return {
    ...actual,
    // The models of "the last council" and a confirmed list – the real ones are tested in packages/db and packages/council.
    lastCouncilParticipants: async () => [
      { credentialId: "cred_a", modelId: "model-a", provider: "anthropic" },
      { credentialId: "cred_b", modelId: "model-b", provider: "openai" },
    ],
    assertCurrentRequirementList: async () => {
      if (!requirementsCurrent) throw new DomainError("CONFLICT", "Confirm the requirements first");
      return { list: { version: 3, items: [] }, state: { briefId: "brf_1" } };
    },
  };
});
const createSession = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 30));
  return { id: `ses_${createSession.mock.calls.length}` };
});
vi.mock("@consyrium/council", () => ({
  previewSession: async () => ({
    policy: { tokenBudget: 200_000 },
    estimate: { upperBound, minimumBudget: 50_000, typical: null },
    planLimit: null,
    finalVerdictSize: { fits: true, message: null },
    modelWarnings: [],
  }),
  createSession: (...args: unknown[]) => (createSession as unknown as (...a: unknown[]) => Promise<{ id: string }>)(...args),
}));

const { POST } = await import("./route");

let ids: { id: string; messageId: string; actionId: string };
const call = (body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve(ids),
  });

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u_start", name: "Owner", email: "start@example.test" });
  actor = await resolveActor(handle.db, "u_start", (await ensurePersonalOrganization(handle.db, "u_start", "Owner")).id);
  const project = await createProject(handle.db, actor, { name: "DB choice", type: "idea", brief: { idea: "Pick a database for a small internal tool." } });
  const chat = await createAssistantChat(handle.db, actor, { title: "Start" });
  const { actions } = acceptActionProposals([{ type: "start_council", params: { projectId: project.id }, summary: "Start the council" }]);
  const message = await addAssistantMessage(handle.db, actor, chat.id, { role: "assistant", content: "Here is the card.", actions });
  ids = { id: chat.id, messageId: message.id, actionId: actions[0]!.id };
});

afterAll(async () => {
  await handle.close();
});

describe("council start from the assistant card (#215 stage 2)", () => {
  it("shows the preview without starting, refuses without consent and after a change, then starts exactly once", async () => {
    const preview = await call({ preview: true });
    const p = (await preview.json()) as { preview: { models: string[]; tokenBudget: number; upperBound: number; startable: boolean }; previewHash: string };
    expect(p.preview).toMatchObject({ models: ["model-a", "model-b"], tokenBudget: 200_000, upperBound: 120_000, startable: true });
    expect(createSession).not.toHaveBeenCalled();

    expect((await call({ previewHash: p.previewHash })).status).toBe(422); // no "costs confirmed"
    // The estimate changed between preview and click → a new confirmation is needed (TOCTOU).
    upperBound = 180_000;
    const changed = await call({ confirmCosts: true, previewHash: p.previewHash });
    expect(changed.status).toBe(409);
    const fresh = ((await changed.json()) as { previewHash: string }).previewHash;
    expect(createSession).not.toHaveBeenCalled();

    // Double click with the fresh preview: one council.
    const [a, b] = await Promise.all([call({ confirmCosts: true, previewHash: fresh }), call({ confirmCosts: true, previewHash: fresh })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ confirmBudget: true, mode: "independent_expert" })]));
    // A later click returns the executed card with the same session.
    const again = await call({ confirmCosts: true, previewHash: fresh });
    const body = (await again.json()) as { action: { status: string; result: { href: string } } };
    expect(body.action).toMatchObject({ status: "executed", result: { href: "/sessions/ses_1" } });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("is not startable while the requirement list is not confirmed for the current brief", async () => {
    requirementsCurrent = false;
    const chat = await createAssistantChat(handle.db, actor, { title: "No list" });
    const projectId = (await handle.db.select().from(schema.project))[0]!.id;
    const { actions } = acceptActionProposals([{ type: "start_council", params: { projectId }, summary: "Start" }]);
    const message = await addAssistantMessage(handle.db, actor, chat.id, { role: "assistant", content: "Card", actions });
    ids = { id: chat.id, messageId: message.id, actionId: actions[0]!.id };
    const p = (await (await call({ preview: true })).json()) as { preview: { startable: boolean; requirements: { current: boolean } }; previewHash: string };
    expect(p.preview).toMatchObject({ startable: false, requirements: { current: false } });
    expect((await call({ confirmCosts: true, previewHash: p.previewHash })).status).toBe(409);
    requirementsCurrent = true;
  });
});
