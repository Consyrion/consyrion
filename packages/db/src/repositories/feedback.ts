import { assertCan, DomainError } from "@consyrion/core";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../client";
import { newId } from "../ids";
import { councilSession, feedback, feedbackReply, project, user } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { sniffImageType } from "./documents";

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
export const FEEDBACK_LIMITS = { subject: 120, text: 4000, reply: 4000, screenshotBytes: 3_000_000 } as const;

export const feedbackInput = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  subject: z.string().trim().min(1).max(FEEDBACK_LIMITS.subject),
  text: z.string().trim().min(1).max(FEEDBACK_LIMITS.text),
  page: z.string().trim().max(300).nullish(),
  locale: z.string().trim().max(10).nullish(),
  agent: z.string().trim().max(400).nullish(),
  appVersion: z.string().trim().max(60).nullish(),
  /** Optional screenshot as base64 (no data: prefix); PNG, JPEG, WebP or GIF, at most 3 MB. */
  screenshot: z
    .string()
    .max(Math.ceil((FEEDBACK_LIMITS.screenshotBytes * 4) / 3) + 4)
    .nullish(),
  /** #295 stage 3: project/council of the page, sent only with the user's consent; ignored for visitors. */
  context: z
    .object({ projectId: z.string().trim().max(60).optional(), sessionId: z.string().trim().max(60).optional() })
    .nullish(),
});
export type FeedbackInput = z.input<typeof feedbackInput>;

/** A signed-in user in their current workspace, or a visitor who leaves an e-mail address. */
export type FeedbackAuthor = { kind: "user"; actor: ActorContext } | { kind: "visitor"; email: string };

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError("VALIDATION", "Check the highlighted fields", z.flattenError(result.error as z.ZodError<Record<string, unknown>>));
  return result.data;
}

/**
 * Checks a screenshot like an image document (decoded size, file signature – the name or a claimed type is not
 * trusted) and returns it as a data URL, which is what the column stores and the admin inbox shows.
 */
function screenshotDataUrl(base64: string | null | undefined): string | null {
  if (!base64) return null;
  const clean = base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean))
    throw new DomainError("VALIDATION", "The screenshot is not a valid image", { fieldErrors: { screenshot: ["invalid"] } });
  const bytes = Uint8Array.from(Buffer.from(clean, "base64"));
  if (bytes.byteLength > FEEDBACK_LIMITS.screenshotBytes)
    throw new DomainError("VALIDATION", "The screenshot may be at most 3 MB", { fieldErrors: { screenshot: ["too_large"] } });
  const type = sniffImageType(bytes);
  if (!type) throw new DomainError("VALIDATION", "Supported screenshots are PNG, JPEG, WebP and GIF", { fieldErrors: { screenshot: ["invalid"] } });
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
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
      screenshot: screenshotDataUrl(data.screenshot),
      context: author.kind === "user" ? await ownContext(db, author.actor, data.context) : null,
    })
    .returning();
  return row!;
}

/**
 * The page context a user agreed to send (#295 stage 3), reduced to ids of the user's current workspace: an id from
 * another workspace (or a made-up one) is dropped, so a report can never point an admin at foreign data.
 */
async function ownContext(db: Database, actor: ActorContext, context: { projectId?: string; sessionId?: string } | null | undefined) {
  if (!context) return null;
  const out: { projectId?: string; sessionId?: string } = {};
  if (context.projectId) {
    const [row] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, context.projectId), eq(project.organizationId, actor.organizationId)))
      .limit(1);
    if (row) out.projectId = row.id;
  }
  if (context.sessionId) {
    const [row] = await db
      .select({ id: councilSession.id, projectId: councilSession.projectId })
      .from(councilSession)
      .where(and(eq(councilSession.id, context.sessionId), eq(councilSession.organizationId, actor.organizationId)))
      .limit(1);
    if (row) {
      out.sessionId = row.id;
      out.projectId ??= row.projectId;
    }
  }
  return out.projectId || out.sessionId ? out : null;
}

/** Replies to the user's own reports that arrived after they last looked (#295 stage 3, badge in the sidebar). */
export async function countUnreadFeedbackReplies(db: Database, ctx: ActorContext) {
  const [row] = await db
    .select({ n: count() })
    .from(feedbackReply)
    .innerJoin(feedback, eq(feedback.id, feedbackReply.feedbackId))
    .where(and(eq(feedback.userId, ctx.userId), sql`${feedbackReply.createdAt} > coalesce(${feedback.replySeenAt}, 'epoch'::timestamptz)`));
  return Number(row?.n ?? 0);
}

/** The user opened "My reports": every reply so far counts as read. */
export async function markFeedbackRepliesSeen(db: Database, ctx: ActorContext, now = new Date()) {
  await db.update(feedback).set({ replySeenAt: now }).where(eq(feedback.userId, ctx.userId));
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
      replySeenAt: feedback.replySeenAt,
    })
    .from(feedback)
    .where(eq(feedback.userId, ctx.userId))
    .orderBy(desc(feedback.createdAt))
    .limit(100);
  const replies = await repliesFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map(({ replySeenAt, ...r }) => ({
    ...r,
    // #295 stage 3: replies that arrived after the user last opened "My reports".
    replies: replies
      .filter((x) => x.feedbackId === r.id)
      .map(({ feedbackId: _f, ...rest }) => ({ ...rest, unread: !replySeenAt || rest.createdAt > replySeenAt })),
  }));
}

/* ---------- Platform admin ---------- */

export interface PlatformAdminContext {
  readonly userId: string;
  readonly email: string;
}

const issued = new WeakSet<PlatformAdminContext>();

/**
 * A platform admin is a user whose stored e-mail is in the configured list (PLATFORM_ADMIN_EMAILS). With
 * `requireVerifiedEmail` (set whenever the server verifies e-mail addresses) the address must also be verified, so
 * registering an unclaimed admin address does not grant admin rights. Unknown users and non-admins get the same
 * "not found" as the hidden /admin page.
 */
export async function resolvePlatformAdmin(
  db: Database,
  userId: string,
  adminEmails: readonly string[],
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<PlatformAdminContext> {
  const allowed = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const [row] = await db.select({ email: user.email, emailVerified: user.emailVerified }).from(user).where(eq(user.id, userId)).limit(1);
  if (!row || !allowed.has(row.email.toLowerCase())) throw new DomainError("NOT_FOUND", "Not found");
  if (options.requireVerifiedEmail && !row.emailVerified) throw new DomainError("NOT_FOUND", "Not found");
  const ctx: PlatformAdminContext = Object.freeze({ userId, email: row.email });
  issued.add(ctx);
  return ctx;
}

/** Every platform-admin read checks the context came from resolvePlatformAdmin (not built by hand). */
export function assertPlatformAdmin(admin: PlatformAdminContext) {
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
  await recordAudit(db, {
    organizationId: null,
    actorUserId: admin.userId,
    action: "admin.feedback_state_changed",
    targetType: "feedback",
    targetId: id,
    metadata: { state: value },
  });
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
  // No reply text in the audit log: it may contain personal data of the author.
  await recordAudit(db, { organizationId: null, actorUserId: admin.userId, action: "admin.feedback_replied", targetType: "feedback", targetId: id });
  return reply!;
}

/** Hard delete (also on request of the author, privacy): the report and its replies are gone. */
export async function deleteFeedback(db: Database, admin: PlatformAdminContext, id: string) {
  assertPlatformAdmin(admin);
  const deleted = await db.delete(feedback).where(eq(feedback.id, id)).returning({ id: feedback.id });
  if (!deleted.length) throw new DomainError("NOT_FOUND", "Report not found");
  await recordAudit(db, { organizationId: null, actorUserId: admin.userId, action: "admin.feedback_deleted", targetType: "feedback", targetId: id });
}
