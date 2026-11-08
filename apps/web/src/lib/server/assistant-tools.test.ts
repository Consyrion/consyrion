import {
  addDocument,
  createDatabase,
  createProject,
  ensurePersonalOrganization,
  resolveActor,
  schema,
  type ActorContext,
  type DatabaseHandle,
} from "@consyrion/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assistantTools } = await import("./assistant-tools");

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext;
let projectId: string;

const brief = {
  idea: "Vereins-Tool: Mitgliederverwaltung mit Beitragslauf und SEPA-Export",
  goal: "Weniger Handarbeit beim Kassenwart",
  requirements: "- DSGVO-konform",
};

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob"]) await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  const orgA = await ensurePersonalOrganization(handle.db, "alice", "Alice");
  const orgB = await ensurePersonalOrganization(handle.db, "bob", "Bob");
  alice = await resolveActor(handle.db, "alice", orgA.id);
  bob = await resolveActor(handle.db, "bob", orgB.id);
  const project = await createProject(handle.db, alice, { name: "Beitragslauf", type: "technology_choice", brief });
  projectId = project.id;
  await addDocument(handle.db, alice, projectId, {
    name: "konzept.md",
    mimeType: "text/markdown",
    bytes: new TextEncoder().encode("# Konzept\nSEPA-Lastschrift monatlich."),
  });
});
afterAll(async () => {
  await handle.close();
});

const tool = (actor: ActorContext, name: string) => assistantTools(handle.db, actor).find((t) => t.name === name)!;

describe("assistant read tools (#282)", () => {
  it("get_project returns brief, requirement list state, documents and a link to the real page", async () => {
    const { data, links } = await tool(alice, "get_project").run({ projectId });
    expect(data).toMatchObject({
      name: "Beitragslauf",
      brief: { idea: brief.idea, goal: brief.goal },
      requirementList: { version: null, current: false },
      documents: [{ name: "konzept.md", role: "source" }],
      href: `/projects/${projectId}`,
    });
    expect(links?.[0]).toEqual({ label: "Beitragslauf", href: `/projects/${projectId}` });
  });

  it("list_documents describes roles in words; get_build_status says when nothing was built", async () => {
    const docs = await tool(alice, "list_documents").run({ projectId });
    expect((docs.data as { documents: Array<{ name: string; role: string; origin: string }> }).documents).toEqual([
      expect.objectContaining({ name: "konzept.md", role: "source of requirements", origin: "upload" }),
    ]);
    const build = await tool(alice, "get_build_status").run({ sessionId: "ses_none" });
    expect(build.data).toMatchObject({ build: null });
  });

  it("search matches all words in name and brief, case-insensitive", async () => {
    const hit = await tool(alice, "search").run({ query: "sepa KASSENWART" });
    expect((hit.data as { projects: Array<{ name: string }> }).projects.map((p) => p.name)).toEqual(["Beitragslauf"]);
    const miss = await tool(alice, "search").run({ query: "sepa kubernetes" });
    expect((miss.data as { projects: unknown[] }).projects).toEqual([]);
  });

  it("another workspace sees nothing: foreign ids are not found, search finds nothing", async () => {
    await expect(tool(bob, "get_project").run({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(tool(bob, "list_documents").run({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const search = await tool(bob, "search").run({ query: "sepa" });
    expect(search.data).toMatchObject({ projects: [], decisions: [] });
    await expect(tool(alice, "get_project").run({})).rejects.toThrow(/projectId required/);
  });
});
