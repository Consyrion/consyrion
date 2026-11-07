import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { assistantChat, assistantMessage, type AssistantActionRecord } from "../schema";
import type { ActorContext } from "./context";

/**
 * AI assistant chats (#280): private to their user in one workspace. Every query is scoped to organization AND user,
 * so neither another member nor an admin can read a chat. Using the assistant costs tokens on the workspace key, so it
 * needs the same permission as running a council.
 */

const TITLE_MAX = 80;

function ownChat(ctx: ActorContext, chatId: string) {
  return and(eq(assistantChat.id, chatId), eq(assistantChat.organizationId, ctx.organizationId), eq(assistantChat.userId, ctx.userId));
}

export async function listAssistantChats(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "decision:run");
  return db
    .select({
      id: assistantChat.id,
      title: assistantChat.title,
      updatedAt: assistantChat.updatedAt,
      contextKind: assistantChat.contextKind,
      contextId: assistantChat.contextId,
    })
    .from(assistantChat)
    .where(and(eq(assistantChat.organizationId, ctx.organizationId), eq(assistantChat.userId, ctx.userId)))
    .orderBy(desc(assistantChat.updatedAt))
    .limit(100);
}

export async function createAssistantChat(
  db: Database,
  ctx: ActorContext,
  input: { title: string; credentialId?: string | null; modelId?: string | null; contextKind?: string | null; contextId?: string | null },
) {
  assertCan(ctx.role, "decision:run");
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "New chat";
  const [row] = await db
    .insert(assistantChat)
    .values({
      id: newId("ach"),
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      title,
      credentialId: input.credentialId ?? null,
      modelId: input.modelId ?? null,
      contextKind: input.contextKind ?? null,
      contextId: input.contextId ?? null,
    })
    .returning();
  return row!;
}

export async function getAssistantChat(db: Database, ctx: ActorContext, chatId: string) {
  assertCan(ctx.role, "decision:run");
  const [chat] = await db.select().from(assistantChat).where(ownChat(ctx, chatId)).limit(1);
  if (!chat) throw new DomainError("NOT_FOUND", "Chat not found");
  const messages = await db.select().from(assistantMessage).where(eq(assistantMessage.chatId, chatId)).orderBy(asc(assistantMessage.createdAt));
  return { chat, messages };
}

export async function addAssistantMessage(
  db: Database,
  ctx: ActorContext,
  chatId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    model?: string | null;
    tools?: Array<{ name: string; args: Record<string, unknown> }> | null;
    links?: Array<{ label: string; href: string }> | null;
    actions?: AssistantActionRecord[] | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
) {
  assertCan(ctx.role, "decision:run");
  const [chat] = await db.select({ id: assistantChat.id }).from(assistantChat).where(ownChat(ctx, chatId)).limit(1);
  if (!chat) throw new DomainError("NOT_FOUND", "Chat not found");
  const [row] = await db
    .insert(assistantMessage)
    .values({ id: newId("acm"), chatId, ...message, content: message.content.slice(0, 20_000) })
    .returning();
  await db.update(assistantChat).set({ updatedAt: new Date() }).where(eq(assistantChat.id, chatId));
  return row!;
}

/** Remembers the model of a chat (the next answer uses it). */
export async function setAssistantChatModel(db: Database, ctx: ActorContext, chatId: string, credentialId: string, modelId: string) {
  assertCan(ctx.role, "decision:run");
  const updated = await db.update(assistantChat).set({ credentialId, modelId }).where(ownChat(ctx, chatId)).returning({ id: assistantChat.id });
  if (!updated.length) throw new DomainError("NOT_FOUND", "Chat not found");
}

/** Hard delete (privacy): the chat and its messages are gone. */
export async function deleteAssistantChat(db: Database, ctx: ActorContext, chatId: string) {
  assertCan(ctx.role, "decision:run");
  const deleted = await db.delete(assistantChat).where(ownChat(ctx, chatId)).returning({ id: assistantChat.id });
  if (!deleted.length) throw new DomainError("NOT_FOUND", "Chat not found");
}
