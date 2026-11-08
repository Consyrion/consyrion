import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../client";
import { assistantMessage, auditEvent, membership, user } from "../schema";
import { addAssistantMessage, createAssistantChat, getAssistantChat } from "./assistant";
import { acceptActionProposals, ASSISTANT_ACTION_TYPES, decideAssistantAction } from "./assistant-actions";
import { resolveActor, type ActorContext } from "./context";
import { createOrganization, ensurePersonalOrganization } from "./organizations";
import { createProject, getProject, listProjects } from "./projects";

let handle: DatabaseHandle;
let alice: ActorContext;
let bob: ActorContext; // other workspace
let carol: ActorContext; // admin in Alice's workspace

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob", "carol"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  const orgA = await ensurePersonalOrganization(handle.db, "alice", "Alice");
  const orgB = await createOrganization(handle.db, "bob", { name: "Bob Inc" });
  await handle.db.insert(membership).values({ id: "mem_carol", organizationId: orgA.id, userId: "carol", role: "admin" });
  alice = await resolveActor(handle.db, "alice", orgA.id);
  bob = await resolveActor(handle.db, "bob", orgB.id);
  carol = await resolveActor(handle.db, "carol", orgA.id);
});

afterAll(async () => {
  await handle.close();
});

/** Stores an assistant answer with the given (already accepted) actions, as the message route does. */
async function answerWith(ctx: ActorContext, raw: Array<{ type: unknown; params: unknown; summary?: unknown }>) {
  const chat = await createAssistantChat(handle.db, ctx, { title: "Help me" });
  const { actions } = acceptActionProposals(raw.map((r) => ({ summary: "s", ...r })));
  const message = await addAssistantMessage(handle.db, ctx, chat.id, { role: "assistant", content: "Here is a suggestion.", actions });
  return { chat, message, actions };
}

const FORBIDDEN = [
  "approve",
  "reject",
  "approve_proposal",
  "start_council",
  "start_build",
  "delete_project",
  "archive_project",
  "update_billing",
  "add_key",
  "delete_key",
  "change_settings",
  "invite_member",
  "remove_member",
  "__proto__",
  "constructor",
];

describe("assistant actions (#283): suggested by the model, run only on the user's click", () => {
  it("drops every type outside the allowlist and invalid parameters when the answer is stored", () => {
    const { actions, rejected } = acceptActionProposals([
      ...FORBIDDEN.map((type) => ({ type, params: { projectId: "prj_1", sessionId: "ses_1" }, summary: "x" })),
      { type: "prepare_council", params: { projectId: "not-an-id" }, summary: "bad id" },
      { type: "prepare_council", params: { projectId: "prj_ok" }, summary: "Open the council form" },
    ]);
    expect(actions.map((a) => a.type)).toEqual(["prepare_council"]);
    expect(actions[0]).toMatchObject({ status: "proposed", summary: "Open the council form", params: { projectId: "prj_ok" } });
    expect(rejected.filter((r) => r.reason === "not_allowed").map((r) => r.type)).toEqual(FORBIDDEN);
    expect(rejected.filter((r) => r.reason === "invalid")).toHaveLength(1);
    // The allowlist itself contains nothing that approves, starts, deletes, bills or changes settings/members.
    expect(ASSISTANT_ACTION_TYPES.some((t) => /approve|reject|start|build|delete|billing|key|setting|member/.test(t))).toBe(false);
  });

  it("accepts the requirements of a project draft as a list and joins them into lines (live test 08.11.26)", () => {
    const { actions, rejected } = acceptActionProposals([
      {
        type: "create_project_draft",
        params: {
          name: "Monolith vs. Microservices",
          idea: "Architektur für ein neues Produkt eines Startups mit 3 Entwicklern.",
          requirements: ["Ein Deployment", "- Klare Modulgrenzen", " "],
        },
        summary: "Projektentwurf",
      },
    ]);
    expect(rejected).toEqual([]);
    expect(actions[0]!.params).toMatchObject({ requirements: "- Ein Deployment\n- Klare Modulgrenzen", goal: "" });
  });

  it("refuses a forbidden type at the execute step even if one was stored", async () => {
    for (const type of FORBIDDEN.slice(0, 11)) {
      const chat = await createAssistantChat(handle.db, alice, { title: "x" });
      const message = await addAssistantMessage(handle.db, alice, chat.id, {
        role: "assistant",
        content: "x",
        actions: [{ id: `aca_${type}`, type, summary: "x", params: {}, status: "proposed" }],
      });
      await expect(
        decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: `aca_${type}`, decision: "execute" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("creates a project only as a draft, once, and records 'suggested by the assistant, confirmed by the user'", async () => {
    const before = (await listProjects(handle.db, alice)).length;
    const { chat, message, actions } = await answerWith(alice, [
      { type: "create_project_draft", params: { name: "Todo tags", idea: "Let users tag their todos and filter by tag." } },
    ]);
    expect((await listProjects(handle.db, alice)).length).toBe(before); // nothing happens without a click
    const done = await decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id, decision: "execute" });
    expect(done.status).toBe("executed");
    expect(done.result?.href).toMatch(/^\/projects\/prj_/);
    const created = await getProject(handle.db, alice, done.result!.href.split("/")[2]!);
    expect(created.status).toBe("draft");
    await expect(
      decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id, decision: "execute" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const stored = (await getAssistantChat(handle.db, alice, chat.id)).messages.find((m) => m.id === message.id)!;
    expect(stored.actions?.[0]?.status).toBe("executed");
    const [audit] = await handle.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "assistant.action_executed"), eq(auditEvent.targetId, chat.id)));
    expect(audit?.metadata).toMatchObject({ type: "create_project_draft", proposedBy: "ai_assistant", confirmedBy: "alice", edited: false });
  });

  it("uses the user's edited parameters, validated like the model's, and never lets the type change", async () => {
    const { chat, message, actions } = await answerWith(alice, [
      { type: "create_project_draft", params: { name: "Draft A", idea: "An idea with enough characters." } },
    ]);
    await expect(
      decideAssistantAction(handle.db, alice, {
        chatId: chat.id,
        messageId: message.id,
        actionId: actions[0]!.id,
        decision: "execute",
        params: { name: "x", idea: "short" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const done = await decideAssistantAction(handle.db, alice, {
      chatId: chat.id,
      messageId: message.id,
      actionId: actions[0]!.id,
      decision: "execute",
      params: { name: "Draft B", idea: "An idea with enough characters.", type: "business" },
    });
    expect(done).toMatchObject({ type: "create_project_draft", edited: true, params: { name: "Draft B" } });
  });

  it("adds proposed requirements to a new brief version (unconfirmed) and keeps the repository link", async () => {
    const project = await createProject(handle.db, alice, {
      name: "Shop",
      type: "repository",
      brief: { idea: "Rebuild the checkout of our shop.", requirements: "- must support PayPal", repositoryUrl: "https://github.com/acme/shop" },
    });
    const { chat, message, actions } = await answerWith(alice, [
      { type: "propose_requirements", params: { projectId: project.id, requirements: ["Checkout must load in under 2 s"] } },
    ]);
    await decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id, decision: "execute" });
    const after = await getProject(handle.db, alice, project.id);
    expect(after.brief).toMatchObject({
      version: 2,
      requirements: "- must support PayPal\n- Checkout must load in under 2 s",
      repositoryUrl: "https://github.com/acme/shop",
    });
  });

  it("prepare_council only links to the form; dismiss changes nothing but the status", async () => {
    const project = (await listProjects(handle.db, alice)).find((p) => p.name === "Shop")!;
    const { chat, message, actions } = await answerWith(alice, [
      { type: "prepare_council", params: { projectId: project.id } },
      { type: "draft_customer_summary", params: { text: "Dear customer, …" } },
    ]);
    const prepared = await decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id, decision: "execute" });
    expect(prepared.result).toEqual({ label: "Shop", href: `/projects/${project.id}/council/new` });
    const dismissed = await decideAssistantAction(handle.db, alice, { chatId: chat.id, messageId: message.id, actionId: actions[1]!.id, decision: "dismiss" });
    expect(dismissed.status).toBe("dismissed");
  });

  it("is private: another member or another workspace cannot run a user's suggestion, nor reach other projects", async () => {
    const { chat, message, actions } = await answerWith(alice, [{ type: "draft_customer_summary", params: { text: "Hello" } }]);
    for (const ctx of [carol, bob])
      await expect(
        decideAssistantAction(handle.db, ctx, { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id, decision: "execute" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const aliceProject = (await listProjects(handle.db, alice))[0]!;
    const own = await answerWith(bob, [{ type: "prepare_council", params: { projectId: aliceProject.id } }]);
    await expect(
      decideAssistantAction(handle.db, bob, { chatId: own.chat.id, messageId: own.message.id, actionId: own.actions[0]!.id, decision: "execute" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [row] = await handle.db.select().from(assistantMessage).where(eq(assistantMessage.id, own.message.id));
    expect(row?.actions?.[0]?.status).toBe("proposed"); // failed run leaves it open
  });
});
