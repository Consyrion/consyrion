import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client";
import { membership, user } from "../schema";
import { addAssistantMessage, createAssistantChat, deleteAssistantChat, getAssistantChat, listAssistantChats } from "./assistant";
import { resolveActor, type ActorContext } from "./context";
import { createOrganization, ensurePersonalOrganization } from "./organizations";

let handle: DatabaseHandle;
let alice: ActorContext;
let carol: ActorContext; // admin in Alice's workspace
let viewer: ActorContext;
let bob: ActorContext; // other workspace

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  for (const id of ["alice", "bob", "carol", "vic"]) await handle.db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  const orgA = await ensurePersonalOrganization(handle.db, "alice", "Alice");
  const orgB = await createOrganization(handle.db, "bob", { name: "Bob Inc" });
  await handle.db.insert(membership).values([
    { id: "mem_carol", organizationId: orgA.id, userId: "carol", role: "admin" },
    { id: "mem_vic", organizationId: orgA.id, userId: "vic", role: "viewer" },
  ]);
  alice = await resolveActor(handle.db, "alice", orgA.id);
  carol = await resolveActor(handle.db, "carol", orgA.id);
  viewer = await resolveActor(handle.db, "vic", orgA.id);
  bob = await resolveActor(handle.db, "bob", orgB.id);
});

afterAll(async () => {
  await handle.close();
});

describe("assistant chats (#280): private per user and workspace", () => {
  it("stores a chat with its messages for its owner only", async () => {
    const chat = await createAssistantChat(handle.db, alice, { title: "  Which   projects wait for approval?  " });
    expect(chat.title).toBe("Which projects wait for approval?");
    await addAssistantMessage(handle.db, alice, chat.id, { role: "user", content: "Which projects wait for approval?" });
    await addAssistantMessage(handle.db, alice, chat.id, { role: "assistant", content: "One: Todo tags.", model: "anthropic/claude-haiku-5-5", inputTokens: 900, outputTokens: 40 });
    const loaded = await getAssistantChat(handle.db, alice, chat.id);
    expect(loaded.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((await listAssistantChats(handle.db, alice)).map((c) => c.id)).toContain(chat.id);

    // Not even an admin of the same workspace, and nobody from another workspace.
    await expect(getAssistantChat(handle.db, carol, chat.id)).rejects.toThrow(/not found/i);
    await expect(getAssistantChat(handle.db, bob, chat.id)).rejects.toThrow(/not found/i);
    await expect(addAssistantMessage(handle.db, bob, chat.id, { role: "user", content: "x" })).rejects.toThrow(/not found/i);
    await expect(deleteAssistantChat(handle.db, carol, chat.id)).rejects.toThrow(/not found/i);
    expect(await listAssistantChats(handle.db, carol)).toHaveLength(0);
  });

  it("needs the permission to run decisions (it costs tokens) and deletes for real", async () => {
    await expect(listAssistantChats(handle.db, viewer)).rejects.toThrow(/permission/i);
    const chat = await createAssistantChat(handle.db, alice, { title: "temp" });
    await deleteAssistantChat(handle.db, alice, chat.id);
    await expect(getAssistantChat(handle.db, alice, chat.id)).rejects.toThrow(/not found/i);
  });
});
