import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, type DatabaseHandle } from "../client";
import { assistantMessage, auditEvent, membership, user } from "../schema";
import { addAssistantMessage, createAssistantChat, getAssistantChat } from "./assistant";
import { acceptActionProposals, ASSISTANT_ACTION_TYPES, completeCouncilStartAction, decideAssistantAction, getAssistantAction } from "./assistant-actions";
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
    expect(ASSISTANT_ACTION_TYPES.some((t) => /approve|reject|build|delete|billing|key|setting|member/.test(t))).toBe(false);
    // The only start is start_council (#215 stage 2), and the generic route never runs it (see the test below).
    expect(ASSISTANT_ACTION_TYPES.filter((t) => /start/.test(t))).toEqual(["start_council"]);
  });

  it("keeps a project card when the model slipped on a detail: overlong name, unknown type, null goal (#583)", () => {
    const { actions, rejected } = acceptActionProposals([
      {
        type: "create_project_draft",
        params: { name: "N".repeat(200), type: "sap_migration", idea: "Kann die Abrechnung in das neue System übernommen werden?", goal: null },
        summary: "Projektentwurf",
      },
      // A draft without a real idea stays invalid – nothing is invented.
      { type: "create_project_draft", params: { name: "Leer", idea: "zu kurz" }, summary: "x" },
    ]);
    expect(rejected).toEqual([{ type: "create_project_draft", reason: "invalid" }]);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.params).toMatchObject({ name: "N".repeat(120), type: "idea", goal: "" });
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

describe("council start card (#215 stage 2)", () => {
  it("is never run by the generic action route, can be dismissed, and is completed once with an audit entry", async () => {
    // An existing project of earlier tests (the plan allows only a few active projects).
    const [project] = await listProjects(handle.db, alice);
    if (!project) throw new Error("no project");
    const { chat, message, actions } = await answerWith(alice, [{ type: "start_council", params: { projectId: project.id, tokenBudget: 200_000 } }]);
    const ids = { chatId: chat.id, messageId: message.id, actionId: actions[0]!.id };
    expect(actions[0]).toMatchObject({ type: "start_council", params: { projectId: project.id, tokenBudget: 200_000 } });
    // A budget above the maximum is not even a valid suggestion.
    expect(acceptActionProposals([{ type: "start_council", params: { projectId: project.id, tokenBudget: 50_000_000 }, summary: "x" }]).actions).toHaveLength(
      0,
    );
    // The generic "Run" never starts a council – only the council route with preview and cost confirmation.
    await expect(decideAssistantAction(handle.db, alice, { ...ids, decision: "execute" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getAssistantAction(handle.db, alice, ids)).status).toBe("proposed");
    // Another workspace cannot read or complete the card.
    await expect(getAssistantAction(handle.db, bob, ids)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeCouncilStartAction(handle.db, bob, ids, { sessionId: "ses_x", label: "x", tokenBudget: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const first = await completeCouncilStartAction(handle.db, alice, ids, { sessionId: "ses_started", label: project.name, tokenBudget: 200_000 });
    expect(first).toMatchObject({ status: "executed", result: { href: "/sessions/ses_started" } });
    // A second click finds it executed and gets the same session, no second audit entry.
    const again = await completeCouncilStartAction(handle.db, alice, ids, { sessionId: "ses_other", label: project.name, tokenBudget: 200_000 });
    expect(again.result).toEqual(first.result);
    const audits = await handle.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "assistant.council_started"), eq(auditEvent.targetId, chat.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ sessionId: "ses_started", budget: 200_000, proposedBy: "ai_assistant", confirmedBy: "alice" });

    // A dismissed card cannot be started.
    const other = await answerWith(alice, [{ type: "start_council", params: { projectId: project.id } }]);
    const otherIds = { chatId: other.chat.id, messageId: other.message.id, actionId: other.actions[0]!.id };
    await decideAssistantAction(handle.db, alice, { ...otherIds, decision: "dismiss" });
    await expect(completeCouncilStartAction(handle.db, alice, otherIds, { sessionId: "ses_y", label: "x", tokenBudget: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("the user's leaning is never a weight (#215 stage 3)", () => {
  it("no card type can carry weights, vote weights or roles", () => {
    for (const type of ASSISTANT_ACTION_TYPES) {
      const parsed = acceptActionProposals([
        {
          type,
          params: {
            projectId: "prj_1",
            name: "x",
            idea: "A decision with options A and B to compare.",
            text: "t",
            channel: "email",
            requirements: ["r"],
            weights: { a: 1 },
            voteWeight: 9,
            roles: ["security"],
          },
          summary: "s",
        },
      ]).actions[0];
      if (parsed) for (const key of ["weights", "voteWeight", "roles"]) expect(parsed.params).not.toHaveProperty(key);
    }
  });
});
