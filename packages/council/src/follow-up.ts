import { assertCan, DomainError, EVALUATION_TOKENS_PER_ITEM_MEASURED, isSelfHosted } from "@consyrion/core";
import { newId, recordAudit, schema, type ActorContext, type Database } from "@consyrion/db";
import { and, asc, eq, ne } from "drizzle-orm";
import { enqueue } from "./queue";

/** The council job (`COUNCIL_JOB` in service.ts) – repeated here to avoid an import cycle; a test keeps both equal. */
export const FOLLOW_UP_JOB = "council.run";

/**
 * #228/#229 follow-up round (owner decision 08.11.26, ADR `docs/adr/0228-0229-follow-up-round.md`, option A): one
 * mechanism, two triggers, always the same evaluators of the frozen round 1.
 *
 * - "completion": an expected evaluator that delivered its evaluation but left checks out (#228 G3, or a lost repair
 *   G2 that still produced a vote) is asked for exactly those (proposal, requirement) items.
 * - "targeted_review": an evaluator is asked again about the items it itself answered UNKNOWN (#229 rule 4a), with the
 *   other evaluators' evidence attached as untrusted data.
 *
 * Never automatic: the owner starts it with a click, sees the estimate and confirms an extra budget. Append-only: the
 * follow-up stores its own checks under its own round; round 1 is never changed. A follow-up answer fills a missing or
 * UNKNOWN check of the same evaluator – a FAIL is never asked again, never replaced and never outvoted.
 */
export type FollowUpKind = "completion" | "targeted_review";

export interface FollowUpItem {
  evaluatorParticipantId: string;
  proposalId: string;
  requirementId: string;
}

/** At most this many follow-up rounds per council: the cost stays bounded, the way on after that is a new council. */
export const MAX_FOLLOW_UP_ROUNDS = 2;

/** Upper bound for the extra budget of one follow-up (same as one council started from a client). */
export const MAX_FOLLOW_UP_BUDGET = 1_000_000;

/**
 * Feature flag: on for the hosted app, off for self-hosted installations unless `FOLLOW_UP_ROUND=true`; the hosted app
 * can switch it off with `FOLLOW_UP_ROUND=false`.
 */
export function followUpRoundEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.FOLLOW_UP_ROUND?.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return !isSelfHosted(env);
}

const key = (r: { evaluatorParticipantId: string; proposalId: string; requirementId: string }) =>
  `${r.evaluatorParticipantId}|${r.proposalId}|${r.requirementId}`;

type CheckLike = { evaluatorParticipantId: string; proposalId: string; requirementId: string; status: string; valid: boolean };

/**
 * The checks the gate counts after follow-ups, in order: for every item a follow-up asked about, a valid answer of
 * that round replaces the same evaluator's earlier valid checks of that item – unless one of them is a FAIL, which
 * stays (and the answer is ignored). Invalid rows stay for display; they never count. Pure; the same input always
 * gives the same output.
 */
export function mergeFollowUpChecks<T extends CheckLike>(
  base: readonly T[],
  followUps: ReadonlyArray<{ items: readonly FollowUpItem[]; rows: readonly T[] }>,
): T[] {
  let current = [...base];
  for (const followUp of followUps) {
    const asked = new Set(followUp.items.map(key));
    for (const item of asked) {
      const answers = followUp.rows.filter((r) => r.valid && key(r) === item);
      if (answers.length === 0) continue;
      if (current.some((r) => r.valid && r.status === "FAIL" && key(r) === item)) continue;
      current = current.filter((r) => !(r.valid && key(r) === item)).concat(answers);
    }
  }
  return current;
}

/**
 * The items of each trigger over the effective checks: completion = an expected evaluator that delivered its
 * evaluation but has no valid check of the item; targeted review = its own valid check of the item is UNKNOWN.
 * Evaluators without a stored evaluation are left to "Repeat the evaluation" (#145).
 */
export function selectFollowUpItems(
  round: { requirementIds: readonly string[]; proposals: ReadonlyArray<{ proposalId: string; expectedEvaluatorIds: readonly string[] }> },
  effective: readonly CheckLike[],
  delivered: ReadonlySet<string>,
): Record<FollowUpKind, FollowUpItem[]> {
  const valid = new Map<string, CheckLike[]>();
  for (const r of effective) if (r.valid) valid.set(key(r), [...(valid.get(key(r)) ?? []), r]);
  const completion: FollowUpItem[] = [];
  const targeted: FollowUpItem[] = [];
  for (const p of round.proposals) {
    for (const evaluatorParticipantId of p.expectedEvaluatorIds) {
      if (!delivered.has(evaluatorParticipantId)) continue;
      for (const requirementId of round.requirementIds) {
        const item = { evaluatorParticipantId, proposalId: p.proposalId, requirementId };
        const own = valid.get(key(item)) ?? [];
        if (own.length === 0) completion.push(item);
        else if (own.every((r) => r.status === "UNKNOWN")) targeted.push(item);
      }
    }
  }
  return { completion, targeted_review: targeted };
}

/**
 * Upper estimate of one follow-up: one call per evaluator that reads the brief and its proposals once, and writes
 * about `EVALUATION_TOKENS_PER_ITEM_MEASURED` per item (the measured worst case of a Final Verdict check item).
 */
export function estimateFollowUpTokens(items: readonly FollowUpItem[], briefChars: number, proposalChars: ReadonlyMap<string, number>): number {
  const byEvaluator = new Map<string, FollowUpItem[]>();
  for (const item of items) byEvaluator.set(item.evaluatorParticipantId, [...(byEvaluator.get(item.evaluatorParticipantId) ?? []), item]);
  let total = 0;
  for (const own of byEvaluator.values()) {
    const proposals = new Set(own.map((i) => i.proposalId));
    const input = Math.ceil((briefChars + [...proposals].reduce((n, id) => n + (proposalChars.get(id) ?? 0), 0)) / 4) + 1_500;
    total += input + own.length * EVALUATION_TOKENS_PER_ITEM_MEASURED + 500;
  }
  return total;
}

type Round = typeof schema.evaluationRound.$inferSelect;

async function sessionOf(db: Database, ctx: ActorContext, sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.councilSession)
    .where(and(eq(schema.councilSession.id, sessionId), eq(schema.councilSession.organizationId, ctx.organizationId)));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  return session;
}

/** Round 1 and its follow-ups with their checks, in order. */
export async function loadRoundsWithChecks(db: Database, sessionId: string) {
  const rounds = await db
    .select()
    .from(schema.evaluationRound)
    .where(eq(schema.evaluationRound.sessionId, sessionId))
    .orderBy(asc(schema.evaluationRound.round));
  const first = rounds.find((r) => r.round === 1) ?? null;
  const checks = first ? await db.select().from(schema.requirementCheck).where(eq(schema.requirementCheck.sessionId, sessionId)) : [];
  const followUps = rounds.filter((r) => r.round > 1 && r.parentRoundId === first?.id);
  return {
    first,
    followUps,
    base: checks.filter((c) => c.roundId === first?.id),
    rowsOf: (round: Round) => checks.filter((c) => c.roundId === round.id),
  };
}

/** What the owner can start now: per trigger the number of items and the estimate (no model call). */
export async function previewFollowUp(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "decision:approve");
  const session = await sessionOf(db, ctx, sessionId);
  const enabled = followUpRoundEnabled();
  const empty = { items: 0, estimatedTokens: 0 };
  if (session.gateVersion < 2) return { enabled, available: false, reason: "old_gate", completion: empty, targetedReview: empty };
  const { first, followUps, base, rowsOf } = await loadRoundsWithChecks(db, sessionId);
  if (!first) return { enabled, available: false, reason: "no_round", completion: empty, targetedReview: empty };
  const done = followUps.filter((r) => r.status === "done");
  const effective = mergeFollowUpChecks(
    base,
    done.map((r) => ({ items: r.items ?? [], rows: rowsOf(r) })),
  );
  const delivered = new Set(
    (await db.select({ id: schema.vote.evaluatorParticipantId }).from(schema.vote).where(eq(schema.vote.sessionId, sessionId))).map((v) => v.id),
  );
  const items = selectFollowUpItems(first, effective, delivered);
  const { briefChars, proposalChars } = await sizes(db, session, first);
  const reason =
    session.status !== "awaiting_approval"
      ? "not_awaiting_decision"
      : followUps.some((r) => r.status === "queued")
        ? "running"
        : followUps.length >= MAX_FOLLOW_UP_ROUNDS
          ? "limit_reached"
          : null;
  return {
    enabled,
    available: enabled && reason === null && (items.completion.length > 0 || items.targeted_review.length > 0),
    reason,
    completion: {
      items: items.completion.length,
      estimatedTokens: items.completion.length ? estimateFollowUpTokens(items.completion, briefChars, proposalChars) : 0,
    },
    targetedReview: {
      items: items.targeted_review.length,
      estimatedTokens: items.targeted_review.length ? estimateFollowUpTokens(items.targeted_review, briefChars, proposalChars) : 0,
    },
  };
}

async function sizes(db: Database, session: typeof schema.councilSession.$inferSelect, round: Round) {
  const [brief] = await db.select().from(schema.projectBrief).where(eq(schema.projectBrief.id, session.briefId));
  const documents = await db
    .select({ size: schema.projectDocument.sizeBytes })
    .from(schema.projectDocument)
    .where(eq(schema.projectDocument.projectId, session.projectId));
  const briefChars = (brief ? brief.idea.length + brief.goal.length + brief.requirements.length : 0) + documents.reduce((n, d) => n + d.size, 0);
  const proposalChars = new Map<string, number>();
  for (const p of round.proposals) {
    const [revision] = await db
      .select({ content: schema.proposalRevision.content })
      .from(schema.proposalRevision)
      .where(eq(schema.proposalRevision.id, p.revisionId));
    proposalChars.set(p.proposalId, JSON.stringify(revision?.content ?? {}).length);
  }
  return { briefChars, proposalChars };
}

/**
 * Starts a follow-up after the owner's click: checks flag, state and items, refuses a budget below the estimate, adds
 * the confirmed extra budget to the council's budget, stores the round (copying round 1's frozen proposals and
 * requirements) and queues the run. The Final Verdict job runs it and recomputes the verdict.
 */
export async function startFollowUp(
  db: Database,
  ctx: ActorContext,
  sessionId: string,
  input: { kind: FollowUpKind; tokenBudget: number; confirmBudget: boolean },
) {
  assertCan(ctx.role, "decision:approve");
  if (!followUpRoundEnabled()) throw new DomainError("FORBIDDEN", "Follow-up rounds are switched off on this installation");
  if (input.kind !== "completion" && input.kind !== "targeted_review") throw new DomainError("VALIDATION", "Unknown follow-up kind");
  if (!input.confirmBudget) throw new DomainError("VALIDATION", "Confirm the extra budget first – a follow-up costs tokens on your own keys");
  const session = await sessionOf(db, ctx, sessionId);
  if (session.gateVersion < 2) throw new DomainError("CONFLICT", "Follow-up rounds exist only for councils with the requirement gate");
  if (session.status !== "awaiting_approval") throw new DomainError("CONFLICT", "A follow-up can only start while the verdict waits for your decision");
  const { first, followUps, base, rowsOf } = await loadRoundsWithChecks(db, sessionId);
  if (!first) throw new DomainError("CONFLICT", "This council has no frozen evaluation round");
  if (followUps.some((r) => r.status === "queued")) throw new DomainError("CONFLICT", "A follow-up is already running");
  if (followUps.length >= MAX_FOLLOW_UP_ROUNDS)
    throw new DomainError("CONFLICT", `At most ${MAX_FOLLOW_UP_ROUNDS} follow-ups per council – change the brief or the requirements and start a new council`);
  const effective = mergeFollowUpChecks(
    base,
    followUps.filter((r) => r.status === "done").map((r) => ({ items: r.items ?? [], rows: rowsOf(r) })),
  );
  const delivered = new Set(
    (await db.select({ id: schema.vote.evaluatorParticipantId }).from(schema.vote).where(eq(schema.vote.sessionId, sessionId))).map((v) => v.id),
  );
  const items = selectFollowUpItems(first, effective, delivered)[input.kind];
  if (items.length === 0) throw new DomainError("CONFLICT", input.kind === "completion" ? "No check is missing" : "No check is open (UNKNOWN)");
  const { briefChars, proposalChars } = await sizes(db, session, first);
  const estimate = estimateFollowUpTokens(items, briefChars, proposalChars);
  if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < estimate || input.tokenBudget > MAX_FOLLOW_UP_BUDGET)
    throw new DomainError(
      "VALIDATION",
      `The extra budget must be between the estimate (${estimate.toLocaleString("en-US")}) and ${MAX_FOLLOW_UP_BUDGET.toLocaleString("en-US")} tokens`,
    );
  const id = newId("rnd");
  const number = Math.max(1, ...followUps.map((r) => r.round)) + 1;
  await db.transaction(async (tx) => {
    await tx.insert(schema.evaluationRound).values({
      id,
      organizationId: ctx.organizationId,
      sessionId,
      round: number,
      requirementListId: first.requirementListId,
      requirementIds: first.requirementIds,
      proposals: first.proposals,
      kind: input.kind,
      parentRoundId: first.id,
      items,
      tokenBudget: input.tokenBudget,
      status: "queued",
      createdById: ctx.userId,
    });
    await tx
      .update(schema.councilSession)
      .set({ status: "queued", finishedAt: null, tokenBudget: session.tokenBudget + input.tokenBudget })
      .where(and(eq(schema.councilSession.id, sessionId), eq(schema.councilSession.status, "awaiting_approval")));
    await tx
      .update(schema.workflowStage)
      .set({ status: "pending", completedAt: null, error: null })
      .where(and(eq(schema.workflowStage.sessionId, sessionId), eq(schema.workflowStage.phase, "final_verdict")));
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "council.follow_up_requested",
      targetType: "council_session",
      targetId: sessionId,
      metadata: { kind: input.kind, round: number, items: items.length, tokenBudget: input.tokenBudget, estimate },
    });
  });
  await enqueue(db, FOLLOW_UP_JOB, { sessionId }, `${FOLLOW_UP_JOB}:${sessionId}:follow-up:${id}`, ctx.organizationId);
  return { roundId: id, round: number, kind: input.kind, items: items.length, estimate, tokenBudget: input.tokenBudget };
}

/** The queued follow-up of a session, if any (the Final Verdict job runs it instead of a normal evaluation). */
export async function pendingFollowUp(db: Database, sessionId: string) {
  const [round] = await db
    .select()
    .from(schema.evaluationRound)
    .where(and(eq(schema.evaluationRound.sessionId, sessionId), eq(schema.evaluationRound.status, "queued"), ne(schema.evaluationRound.kind, "final")))
    .orderBy(asc(schema.evaluationRound.round))
    .limit(1);
  return round ?? null;
}
