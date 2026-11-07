import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { feedback, feedbackReply, user } from "../schema";
import type { ActorContext } from "./context";

/**
 * Feedback inbox (#295): bug reports, feature wishes and contact requests. A report belongs to its author (a signed-in
 * user) or only carries a visitor's e-mail. The author lists their own reports with the replies; the platform admins
 * (PLATFORM_ADMIN_EMAILS) read and answer all of them. Admin calls need a PlatformAdminContext that only
 * `resolvePlatformAdmin` can issue, so a non-admin can never reach the inbox through a cast or a forged object.
 */

export const FEEDBACK_KINDS = ["bug", "feature", "contact"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_STATES = ["new", "in_progress", "done"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];
export const FEEDBACK_LIMITS = { subject: 120, text: 4000, reply: 4000 } as const;

export const feedbackInput = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  subject: z.string().trim().min(1).max(FEEDBACK_LIMITS.subject),
  text: z.string().trim().min(1).max(FEEDBACK_LIMITS.text),
  page: z.string().trim().max(300).nullish(),
  locale: z.string().trim().max(10).nullish(),
  agent: z.string().trim().max(400).nullish(),
  appVersion: z.string().trim().max(60).nullish(),
});
export type FeedbackInput = z.input<typeof feedbackInput>;

/** A signed-in user in their current workspace, or a visitor who leaves an e-mail address. */
export type FeedbackAuthor = { kind: "user"; actor: ActorContext } | { kind: "visitor"; email: string };

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("VALIDATION", "Check the highlighted fields", z.flattenError(result.error as z.ZodError<Record<string, unknown>>));
  return result.data;
}

/** Only the path of the page is kept (no query string or fragment: they may carry tokens). */
function pathOnly(page: string | null | undefined) {
  if (!page) return null;
  const path = page.split(/[?#]/)[0]!.trim();
  return path.startsWith("/") ? path.slice(0, 200) : null;
}

export async function createFeedback(db: Database, author: FeedbackAuthor, input: FeedbackInput) {
  const data = parse(feedbackInput, input);
  let email: string;
  let userId: string | null = null;
  let organizationId: string | null = null;
  if (author.kind === "user") {
    assertCan(author.actor.role, "org:read");
    const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, author.actor.userId)).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "User not found");
    email = row.email;
    userId = author.actor.userId;
    organizationId = author.actor.organizationId;
  } else {
    email = parse(z.string().trim().toLowerCase().email().max(200), author.email);
  }
  const [row] = await db
    .insert(feedback)
    .values({
      id: newId("fbk"),
      organizationId,
      userId,
      email,
      kind: data.kind,
      subject: data.subject.replace(/\s+/g, " "),
      text: data.text,
      page: pathOnly(data.page),
      locale: data.locale ?? null,
      agent: data.agent ?? null,
      appVersion: data.appVersion ?? null,
    })
    .returning();
  return row!;
}

async function repliesFor(db: Database, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({ id: feedbackReply.id, feedbackId: feedbackReply.feedbackId, text: feedbackReply.text, createdAt: feedbackReply.createdAt })
    .from(feedbackReply)
    .where(inArray(feedbackReply.feedbackId, ids))
    .orderBy(asc(feedbackReply.createdAt));
}

/** The user's own reports (from every workspace) with the admins' replies – never anybody else's. */
export async function listMyFeedback(db: Database, ctx: ActorContext) {
  assertCan(ctx.role, "org:read");
  const rows = await db
    .select({
      id: feedback.id,
      kind: feedback.kind,
      subject: feedback.subject,
      text: feedback.text,
      state: feedback.state,
      createdAt: feedback.createdAt,
      doneAt: feedback.doneAt,
    })
    .from(feedback)
    .where(eq(feedback.userId, ctx.userId))
    .orderBy(desc(feedback.createdAt))
    .limit(100);
  const replies = await repliesFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, replies: replies.filter((x) => x.feedbackId === r.id).map(({ feedbackId: _f, ...rest }) => rest) }));
}

/* ---------- Platform admin ---------- */

export interface PlatformAdminContext {
  readonly userId: string;
  readonly email: string;
}

const issued = new WeakSet<PlatformAdminContext>();

/**
 * A platform admin is a user whose stored e-mail is in the configured list (PLATFORM_ADMIN_EMAILS). Unknown users and
 * non-admins get the same "not found" as the hidden /admin page.
 */
export async function resolvePlatformAdmin(db: Database, userId: string, adminEmails: readonly string[]): Promise<PlatformAdminContext> {
  const allowed = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  if (!row || !allowed.has(row.email.toLowerCase())) throw new DomainError("NOT_FOUND", "Not found");
  const ctx: PlatformAdminContext = Object.freeze({ userId, email: row.email });
  issued.add(ctx);
  return ctx;
}

function assertPlatformAdmin(admin: PlatformAdminContext) {
  if (!admin || !issued.has(admin)) throw new DomainError("NOT_FOUND", "Not found");
}

export async function listFeedbackForAdmin(
  db: Database,
  admin: PlatformAdminContext,
  filter: { kind?: FeedbackKind | null; state?: FeedbackState | null } = {},
) {
  assertPlatformAdmin(admin);
  const where: SQL[] = [];
  if (filter.kind) where.push(eq(feedback.kind, filter.kind));
  if (filter.state) where.push(eq(feedback.state, filter.state));
  return db
    .select({
      id: feedback.id,
      kind: feedback.kind,
      subject: feedback.subject,
      email: feedback.email,
      userId: feedback.userId,
      state: feedback.state,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(200);
}

/** Number of reports nobody has looked at yet (badge in the admin menu). */
export async function countNewFeedback(db: Database, admin: PlatformAdminContext) {
  assertPlatformAdmin(admin);
  const [row] = await db.select({ n: count() }).from(feedback).where(eq(feedback.state, "new"));
  return Number(row?.n ?? 0);
}

export async function getFeedbackForAdmin(db: Database, admin: PlatformAdminContext, id: string) {
  assertPlatformAdmin(admin);
  const [row] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Report not found");
  const replies = await db.select().from(feedbackReply).where(eq(feedbackReply.feedbackId, id)).orderBy(asc(feedbackReply.createdAt));
  return { feedback: row, replies };
}

export async function setFeedbackState(db: Database, admin: PlatformAdminContext, id: string, state: FeedbackState) {
  assertPlatformAdmin(admin);
  const value = parse(z.enum(FEEDBACK_STATES), state);
  const updated = await db
    .update(feedback)
    .set({ state: value, doneAt: value === "done" ? new Date() : null })
    .where(eq(feedback.id, id))
    .returning();
  if (!updated.length) throw new DomainError("NOT_FOUND", "Report not found");
  return updated[0]!;
}

/** Stores an answer the author sees in the app; a report nobody had looked at moves to "in progress". */
export async function replyToFeedback(db: Database, admin: PlatformAdminContext, id: string, text: string) {
  assertPlatformAdmin(admin);
  const body = parse(z.string().trim().min(1).max(FEEDBACK_LIMITS.reply), text);
  const [row] = await db.select({ id: feedback.id, state: feedback.state }).from(feedback).where(eq(feedback.id, id)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Report not found");
  const [reply] = await db
    .insert(feedbackReply)
    .values({ id: newId("fbr"), feedbackId: id, adminId: admin.userId, text: body })
    .returning();
  if (row.state === "new") await db.update(feedback).set({ state: "in_progress" }).where(eq(feedback.id, id));
  return reply!;
}

/** Hard delete (also on request of the author, privacy): the report and its replies are gone. */
export async function deleteFeedback(db: Database, admin: PlatformAdminContext, id: string) {
  assertPlatformAdmin(admin);
  const deleted = await db.delete(feedback).where(eq(feedback.id, id)).returning({ id: feedback.id });
  if (!deleted.length) throw new DomainError("NOT_FOUND", "Report not found");
}
