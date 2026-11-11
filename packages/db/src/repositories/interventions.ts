import { assertCan, DomainError } from "@consyrium/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import { newId } from "../ids";
import { councilParticipant, councilSession, humanIntervention, humanInterventionAnswer, usageRecord } from "../schema";
import { recordAudit } from "./audit";
import type { ActorContext } from "./context";
import { assertSessionProjectWritable } from "./projects";

/**
 * Human interventions after the verdict (#15/#41 stage 1): a question to the council, a request for a statement on an
 * objection, or a mark "important". They never write into proposals, scores, votes, checks or the verdict – the models'
 * answers are stored apart as an appendix. Only while a verdict exists (not while the council runs); archived projects
 * are read-only. Same permission as a follow-up round (`decision:approve`).
 */

export type InterventionKind = "question" | "statement_request" | "mark";
export type InterventionTarget = "session" | "objection" | "crux";
export const INTERVENTION_LIMITS = { text: 1_000, answer: 4_000, tokensPerIntervention: 30_000 } as const;

/** States in which a verdict exists and the council no longer runs. */
const AFTER_VERDICT = new Set(["awaiting_approval", "approved", "rejected", "changes_requested"]);

export async function assertInterventionAllowed(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "decision:approve");
  const [session] = await db
    .select({ status: councilSession.status })
    .from(councilSession)
    .where(and(eq(councilSession.id, sessionId), eq(councilSession.organizationId, ctx.organizationId)));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  if (!AFTER_VERDICT.has(session.status))
    throw new DomainError("CONFLICT", "Questions to the council are possible after the verdict – the running debate stays independent");
  await assertSessionProjectWritable(db, ctx, sessionId);
}

export async function createIntervention(
  db: Database,
  ctx: ActorContext,
  input: { sessionId: string; kind: InterventionKind; targetType: InterventionTarget; targetId?: string | null; text?: string },
) {
  await assertInterventionAllowed(db, ctx, input.sessionId);
  const text = (input.text ?? "").trim().slice(0, INTERVENTION_LIMITS.text);
  if (input.kind === "question" && text.length < 3) throw new DomainError("VALIDATION", "Write the question to the council");
  if (input.targetType !== "session" && !input.targetId) throw new DomainError("VALIDATION", "Choose what the intervention refers to");
  const [row] = await db
    .insert(humanIntervention)
    .values({
      id: newId("hiv"),
      organizationId: ctx.organizationId,
      sessionId: input.sessionId,
      userId: ctx.userId,
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      text,
    })
    .returning();
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "council.human_intervention",
    targetType: "council_session",
    targetId: input.sessionId,
    // Never the text itself.
    metadata: { interventionId: row!.id, kind: input.kind, targetType: input.targetType, targetId: input.targetId ?? null },
  });
  return row!;
}

/** A mark "important" on an objection or key dispute: set once, a second call removes it (no model call). */
export async function toggleInterventionMark(
  db: Database,
  ctx: ActorContext,
  input: { sessionId: string; targetType: "objection" | "crux"; targetId: string },
) {
  await assertInterventionAllowed(db, ctx, input.sessionId);
  const [existing] = await db
    .select({ id: humanIntervention.id })
    .from(humanIntervention)
    .where(
      and(
        eq(humanIntervention.sessionId, input.sessionId),
        eq(humanIntervention.organizationId, ctx.organizationId),
        eq(humanIntervention.kind, "mark"),
        eq(humanIntervention.targetType, input.targetType),
        eq(humanIntervention.targetId, input.targetId),
      ),
    );
  if (existing) {
    await db.delete(humanIntervention).where(eq(humanIntervention.id, existing.id));
    return { marked: false };
  }
  await createIntervention(db, ctx, { ...input, kind: "mark" });
  return { marked: true };
}

/**
 * Stores one model's answer and its usage row. The usage row carries the session (real cost of the session) but no
 * phase and `kind: "intervention"`, so phase totals and per-model contribution counts leave it out.
 */
export async function addInterventionAnswer(
  db: Database,
  ctx: ActorContext,
  input: {
    interventionId: string;
    sessionId: string;
    participantId: string | null;
    provider: (typeof usageRecord.$inferInsert)["provider"];
    modelId: string;
    body: string;
    error: string | null;
    outcome: (typeof usageRecord.$inferInsert)["outcome"];
    errorKind: string | null;
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
    durationMs: number;
  },
) {
  return db.transaction(async (tx) => {
    await tx.insert(usageRecord).values({
      id: newId("use"),
      organizationId: ctx.organizationId,
      sessionId: input.sessionId,
      participantId: input.participantId,
      phase: null,
      kind: "intervention",
      provider: input.provider,
      modelId: input.modelId,
      inputTokens: Math.max(0, Math.round(input.usage.inputTokens || 0)),
      outputTokens: Math.max(0, Math.round(input.usage.outputTokens || 0)),
      cachedInputTokens: input.usage.cachedInputTokens ?? 0,
      durationMs: input.durationMs,
      outcome: input.outcome,
      errorKind: input.errorKind,
    });
    const [row] = await tx
      .insert(humanInterventionAnswer)
      .values({
        id: newId("hia"),
        interventionId: input.interventionId,
        organizationId: ctx.organizationId,
        participantId: input.participantId,
        modelId: input.modelId,
        body: input.body.slice(0, INTERVENTION_LIMITS.answer),
        error: input.error,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
      })
      .returning();
    return row!;
  });
}

/** Interventions of a session with their answers, oldest first – for the verdict screen, replay and report. */
export async function listInterventions(db: Database, ctx: ActorContext, sessionId: string) {
  assertCan(ctx.role, "project:read");
  const rows = await db
    .select()
    .from(humanIntervention)
    .where(and(eq(humanIntervention.sessionId, sessionId), eq(humanIntervention.organizationId, ctx.organizationId)))
    .orderBy(asc(humanIntervention.createdAt));
  if (!rows.length) return [];
  const answers = await db
    .select()
    .from(humanInterventionAnswer)
    .where(
      and(
        inArray(
          humanInterventionAnswer.interventionId,
          rows.map((r) => r.id),
        ),
        eq(humanInterventionAnswer.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(asc(humanInterventionAnswer.createdAt));
  return rows.map((r) => ({ ...r, answers: answers.filter((a) => a.interventionId === r.id) }));
}

/** Server-only: which key each participant of a session used (the session view never carries credential ids). */
export async function interventionCredentials(db: Database, ctx: ActorContext, sessionId: string): Promise<Map<string, string>> {
  assertCan(ctx.role, "decision:approve");
  const rows = await db
    .select({ id: councilParticipant.id, credentialId: councilParticipant.credentialId })
    .from(councilParticipant)
    .where(and(eq(councilParticipant.sessionId, sessionId), eq(councilParticipant.organizationId, ctx.organizationId)));
  return new Map(rows.filter((r) => r.credentialId).map((r) => [r.id, r.credentialId!]));
}
