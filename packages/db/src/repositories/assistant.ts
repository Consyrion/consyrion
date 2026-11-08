import { assertCan, DomainError, isUnlimited, UNLIMITED } from "@consyrion/core";
import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import {
  aiProviderCredential,
  assistantChat,
  assistantCheck,
  assistantMessage,
  assistantPreference,
  assistantUsage,
  organization,
  type AssistantActionRecord,
} from "../schema";
import type { ActorContext } from "./context";
import { getEntitlements } from "./saas";

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
  const [messages, checks] = await Promise.all([
    db.select().from(assistantMessage).where(eq(assistantMessage.chatId, chatId)).orderBy(asc(assistantMessage.createdAt)),
    db.select().from(assistantCheck).where(eq(assistantCheck.chatId, chatId)).orderBy(asc(assistantCheck.createdAt)),
  ]);
  return { chat, messages, checks };
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
    /** Second opinion (#281): the answer this message checks. */
    reviewOf?: string | null;
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

/* ---------- Settings, budget and second opinion (#281) ---------- */

export const ASSISTANT_LIMITS = { maxTokenLimit: 100_000_000 } as const;

export interface AssistantPreferenceInput {
  credentialId?: string | null;
  modelId?: string | null;
  reviewerCredentialId?: string | null;
  reviewerModelId?: string | null;
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
}

/** The user's assistant settings in this workspace; all null when never saved. */
export async function getAssistantPreference(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "decision:run");
  const [row] = await db
    .select()
    .from(assistantPreference)
    .where(and(eq(assistantPreference.organizationId, ctx.organizationId), eq(assistantPreference.userId, ctx.userId)))
    .limit(1);
  return {
    credentialId: row?.credentialId ?? null,
    modelId: row?.modelId ?? null,
    reviewerCredentialId: row?.reviewerCredentialId ?? null,
    reviewerModelId: row?.reviewerModelId ?? null,
    dailyTokenLimit: row?.dailyTokenLimit ?? null,
    monthlyTokenLimit: row?.monthlyTokenLimit ?? null,
  };
}

/**
 * Saves the given fields (others stay). Keys must belong to this workspace – a foreign credential id is "not found",
 * so nobody can point the assistant at another workspace's key. Limits are whole tokens, null = no limit.
 */
export async function setAssistantPreference(db: Database, ctx: ActorContext, input: AssistantPreferenceInput) {
  assertCan(ctx.role, "decision:run");
  const credentialIds = [input.credentialId, input.reviewerCredentialId].filter((c): c is string => typeof c === "string" && c.length > 0);
  if (credentialIds.length) {
    const own = await db
      .select({ id: aiProviderCredential.id })
      .from(aiProviderCredential)
      .where(and(eq(aiProviderCredential.organizationId, ctx.organizationId), inArray(aiProviderCredential.id, credentialIds)));
    if (own.length !== new Set(credentialIds).size) throw new DomainError("NOT_FOUND", "AI provider key not found");
  }
  const limit = (value: number | null | undefined, name: string) => {
    if (value === undefined || value === null) return value;
    if (!Number.isInteger(value) || value < 1 || value > ASSISTANT_LIMITS.maxTokenLimit)
      throw new DomainError("VALIDATION", `${name} must be a whole number of tokens between 1 and ${ASSISTANT_LIMITS.maxTokenLimit}`);
    return value;
  };
  const model = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim().slice(0, 200) || null);
  const changes = Object.fromEntries(
    Object.entries({
      credentialId: input.credentialId === undefined ? undefined : input.credentialId || null,
      modelId: model(input.modelId),
      reviewerCredentialId: input.reviewerCredentialId === undefined ? undefined : input.reviewerCredentialId || null,
      reviewerModelId: model(input.reviewerModelId),
      dailyTokenLimit: limit(input.dailyTokenLimit, "The daily limit"),
      monthlyTokenLimit: limit(input.monthlyTokenLimit, "The monthly limit"),
    }).filter(([, v]) => v !== undefined),
  );
  await db
    .insert(assistantPreference)
    .values({ id: newId("asp"), organizationId: ctx.organizationId, userId: ctx.userId, ...changes })
    .onConflictDoUpdate({ target: [assistantPreference.organizationId, assistantPreference.userId], set: { ...changes, updatedAt: new Date() } });
  return getAssistantPreference(db, ctx);
}

/** Records one paid assistant call in the usage ledger (kept when the chat is deleted). */
export async function recordAssistantUsage(db: Database, ctx: ActorContext, kind: AssistantUsageKind, usage: { inputTokens: number; outputTokens: number }) {
  assertCan(ctx.role, "decision:run");
  await db.insert(assistantUsage).values({
    id: newId("asu"),
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    kind,
    inputTokens: Math.max(0, Math.round(usage.inputTokens || 0)),
    outputTokens: Math.max(0, Math.round(usage.outputTokens || 0)),
  });
}

type AssistantUsageKind = "answer" | "council_answer" | "second_opinion" | "summary" | "cross_check";

/**
 * Reserves one paid assistant call BEFORE the model runs (#510, #519), under a row lock of the workspace:
 * - `question: true` (kind "answer"): one question of the plan's daily quota – parallel requests cannot all pass the
 *   check before the first answer is booked (load test: 20 of 20 answered with a limit of 5).
 * - `estimate`: the expected tokens of the call are booked right away as the row's tokens, so the user's daily and
 *   monthly token limits count calls that are still running (load test: +50 % with 10 parallel questions). A call is
 *   refused when used + estimate would pass a limit; the limit can only be passed by an estimate that was too low.
 * Settle the row with the real tokens afterwards, or release it when no answer came.
 */
export async function reserveAssistantUsage(
  db: Database,
  ctx: ActorContext,
  input: { kind: AssistantUsageKind; estimate?: number; question?: boolean },
): Promise<string> {
  assertCan(ctx.role, "decision:run");
  const { plan, entitlements } = await getEntitlements(db, ctx.organizationId);
  const pref = await getAssistantPreference(db, ctx);
  const questionLimit = entitlements.maxAssistantQuestionsPerDay ?? UNLIMITED;
  const estimate = Math.max(0, Math.round(input.estimate ?? 0));
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return db.transaction(async (tx) => {
    await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, ctx.organizationId)).for("update");
    if (input.question && !isUnlimited(questionLimit)) {
      const [row] = await tx
        .select({ n: count() })
        .from(assistantUsage)
        .where(and(eq(assistantUsage.organizationId, ctx.organizationId), eq(assistantUsage.kind, "answer"), gte(assistantUsage.createdAt, day)));
      if (Number(row?.n ?? 0) >= questionLimit)
        throw new DomainError(
          "FORBIDDEN",
          `Your plan allows ${questionLimit} assistant question(s) per day for the workspace (plan: ${plan}). Upgrade under Settings → Billing.`,
        );
    }
    const usedSince = async (since: Date) => {
      const [row] = await tx
        .select({ n: sql<number>`coalesce(sum(${assistantUsage.inputTokens} + ${assistantUsage.outputTokens}), 0)::int` })
        .from(assistantUsage)
        .where(and(eq(assistantUsage.organizationId, ctx.organizationId), eq(assistantUsage.userId, ctx.userId), gte(assistantUsage.createdAt, since)));
      return Number(row?.n ?? 0);
    };
    if (pref.dailyTokenLimit !== null) {
      const today = await usedSince(day);
      if (today + estimate > pref.dailyTokenLimit)
        throw new DomainError(
          "VALIDATION",
          `This needs about ${estimate} tokens, but your daily assistant limit of ${pref.dailyTokenLimit} tokens leaves ${Math.max(0, pref.dailyTokenLimit - today)} (used or running today: ${today}). Raise it in the assistant settings or try tomorrow.`,
        );
    }
    if (pref.monthlyTokenLimit !== null) {
      const thisMonth = await usedSince(month);
      if (thisMonth + estimate > pref.monthlyTokenLimit)
        throw new DomainError(
          "VALIDATION",
          `This needs about ${estimate} tokens, but your monthly assistant limit of ${pref.monthlyTokenLimit} tokens leaves ${Math.max(0, pref.monthlyTokenLimit - thisMonth)} (used or running this month: ${thisMonth}). Raise it in the assistant settings.`,
        );
    }
    const id = newId("asu");
    await tx
      .insert(assistantUsage)
      .values({ id, organizationId: ctx.organizationId, userId: ctx.userId, kind: input.kind, inputTokens: estimate, outputTokens: 0 });
    return id;
  });
}

/** One question of the plan's daily quota plus its estimated tokens (#510, #519). */
export async function reserveAssistantQuestion(db: Database, ctx: ActorContext, estimate = 0): Promise<string> {
  return reserveAssistantUsage(db, ctx, { kind: "answer", estimate, question: true });
}

/** Replaces the estimate of a reservation with the real tokens of the call. */
export async function settleAssistantUsage(db: Database, ctx: ActorContext, reservationId: string, usage: { inputTokens: number; outputTokens: number }) {
  await db
    .update(assistantUsage)
    .set({ inputTokens: Math.max(0, Math.round(usage.inputTokens || 0)), outputTokens: Math.max(0, Math.round(usage.outputTokens || 0)) })
    .where(and(eq(assistantUsage.id, reservationId), eq(assistantUsage.userId, ctx.userId), eq(assistantUsage.organizationId, ctx.organizationId)));
}
export const settleAssistantQuestion = settleAssistantUsage;

/** Gives a reservation back when no answer came (provider error, abort): neither the question nor tokens count. */
export async function releaseAssistantUsage(db: Database, ctx: ActorContext, reservationId: string) {
  await db
    .delete(assistantUsage)
    .where(and(eq(assistantUsage.id, reservationId), eq(assistantUsage.userId, ctx.userId), eq(assistantUsage.organizationId, ctx.organizationId)));
}
export const releaseAssistantQuestion = releaseAssistantUsage;

/** Tokens of the user's paid assistant calls (answers, second opinions, summaries) in this workspace since `since`. */
export async function assistantTokensSince(db: Database, ctx: ActorContext, since: Date): Promise<number> {
  assertCan(ctx.role, "decision:run");
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${assistantUsage.inputTokens} + ${assistantUsage.outputTokens}), 0)::int` })
    .from(assistantUsage)
    .where(and(eq(assistantUsage.organizationId, ctx.organizationId), eq(assistantUsage.userId, ctx.userId), gte(assistantUsage.createdAt, since)));
  return Number(row?.n ?? 0);
}

/**
 * Usage against the user's own limits (UTC day and month). `assertAssistantBudget` refuses a new question once a limit
 * is reached – checked before the call, so one answer may end slightly above the limit.
 */
export async function assistantBudget(db: Database, ctx: ActorContext, now = new Date()) {
  const pref = await getAssistantPreference(db, ctx);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, thisMonth] = await Promise.all([assistantTokensSince(db, ctx, day), assistantTokensSince(db, ctx, month)]);
  return { today, thisMonth, dailyLimit: pref.dailyTokenLimit, monthlyLimit: pref.monthlyTokenLimit };
}

export async function assertAssistantBudget(db: Database, ctx: ActorContext, now = new Date()) {
  const b = await assistantBudget(db, ctx, now);
  if (b.dailyLimit !== null && b.today >= b.dailyLimit)
    throw new DomainError(
      "VALIDATION",
      `Your daily assistant limit of ${b.dailyLimit} tokens is reached (used today: ${b.today}). Raise it in the assistant settings or try tomorrow.`,
    );
  if (b.monthlyLimit !== null && b.thisMonth >= b.monthlyLimit)
    throw new DomainError(
      "VALIDATION",
      `Your monthly assistant limit of ${b.monthlyLimit} tokens is reached (used this month: ${b.thisMonth}). Raise it in the assistant settings.`,
    );
  return b;
}

/** One answer of the user's own chat, for a second opinion: the answer and the question before it. */
export async function getAnswerForReview(db: Database, ctx: ActorContext, chatId: string, messageId: string) {
  const { messages } = await getAssistantChat(db, ctx, chatId);
  const index = messages.findIndex((m) => m.id === messageId);
  const answer = messages[index];
  if (!answer || answer.role !== "assistant" || answer.reviewOf) throw new DomainError("NOT_FOUND", "Answer not found");
  const question = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
  if (messages.some((m) => m.reviewOf === messageId)) throw new DomainError("CONFLICT", "This answer already has a second opinion");
  return { question: question?.content ?? "", answer };
}

/* ---------- Summary of long chats (#280) ---------- */

/** Stores the summary of a chat's earlier part; `until` = time of the last message it covers. */
export async function setAssistantChatSummary(db: Database, ctx: ActorContext, chatId: string, summary: string, until: Date) {
  assertCan(ctx.role, "decision:run");
  const updated = await db
    .update(assistantChat)
    .set({ summary: summary.trim().slice(0, 8_000), summaryUntil: until })
    .where(ownChat(ctx, chatId))
    .returning({ id: assistantChat.id });
  if (!updated.length) throw new DomainError("NOT_FOUND", "Chat not found");
}

/* ---------- Cross-check in the council chat (#241 stage 2) ---------- */

/**
 * One answer of the user's own chat for a cross-check: the answer, the question before it and the models that already
 * checked it (each model checks an answer once). Second opinions are not cross-checked.
 */
export async function getAnswerForCheck(db: Database, ctx: ActorContext, chatId: string, messageId: string) {
  const { messages, checks } = await getAssistantChat(db, ctx, chatId);
  const index = messages.findIndex((m) => m.id === messageId);
  const answer = messages[index];
  if (!answer || answer.role !== "assistant" || answer.reviewOf) throw new DomainError("NOT_FOUND", "Answer not found");
  const question = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
  return { question: question?.content ?? "", answer, checkedBy: checks.filter((c) => c.messageId === messageId).map((c) => c.model) };
}

/** Stores one check; a second check of the same answer by the same model is refused (also for parallel requests). */
export async function addAssistantCheck(
  db: Database,
  ctx: ActorContext,
  chatId: string,
  check: {
    messageId: string;
    model: string;
    verdict: "confirmed" | "contradicted" | "unverifiable";
    reason: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
) {
  assertCan(ctx.role, "decision:run");
  const [chat] = await db.select({ id: assistantChat.id }).from(assistantChat).where(ownChat(ctx, chatId)).limit(1);
  if (!chat) throw new DomainError("NOT_FOUND", "Chat not found");
  const [answer] = await db
    .select({ id: assistantMessage.id })
    .from(assistantMessage)
    .where(and(eq(assistantMessage.id, check.messageId), eq(assistantMessage.chatId, chatId)))
    .limit(1);
  if (!answer) throw new DomainError("NOT_FOUND", "Answer not found");
  const [row] = await db
    .insert(assistantCheck)
    .values({ id: newId("ack"), chatId, ...check, reason: check.reason.slice(0, 2_000) })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new DomainError("CONFLICT", `${check.model} has already checked this answer`);
  return row;
}
