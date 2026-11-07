import { COUNCIL_PHASES, DomainError, type CouncilPhase } from "@consyrion/core";
import { recordAudit, schema, type Database } from "@consyrion/db";
import { and, eq, sql } from "drizzle-orm";
import { CancelledError, type AdapterResolver } from "./call";
import { assertCanEvaluateSession, sessionGateVersions } from "./decision-format";
import { SessionContext } from "./context";
import { assertEngineInstalled } from "./engine-guard";
import { SHORTENED_FOR_BUDGET, verdictReserve } from "./budget";
import { consensusRound, finalVerdict, independentThinking, minorityReviewPhase, openCouncil, twelveMindsCouncil } from "./phases";

export interface EngineDeps {
  db: Database;
  resolveAdapter: AdapterResolver;
  /** Injectable for deterministic tests (reveal order). */
  random?: () => number;
  /** Wait before the late retry of an overloaded provider (#146); tests shorten it. */
  transientRetryDelayMs?: number;
}

/** Phases the engine runs automatically. Execution Council starts only after human approval (M4). */
const AUTOMATIC_PHASES: CouncilPhase[] = COUNCIL_PHASES.filter((phase) => phase !== "execution_council");

/**
 * Phases that may end early when the budget runs short (#148): their results so far stay, the verdict is based on
 * the current revisions. Independent Thinking cannot be shortened (no proposals, no council) and the Final Verdict
 * spends the reserve kept for it.
 */
const SHORTENABLE: ReadonlySet<CouncilPhase> = new Set(["open_council", "twelve_minds_council", "minority_review", "consensus_round"]);

async function setStage(db: Database, sessionId: string, phase: CouncilPhase, values: Partial<typeof schema.workflowStage.$inferInsert>) {
  await db
    .update(schema.workflowStage)
    .set(values)
    .where(and(eq(schema.workflowStage.sessionId, sessionId), eq(schema.workflowStage.phase, phase)));
}

/**
 * Runs (or resumes) a council session. Each phase is a checkpoint: completed stages are skipped on
 * resume, and phases skip work whose results are already stored, so a worker crash never repeats or
 * duplicates finished model calls.
 */
export async function runSession(deps: EngineDeps, sessionId: string): Promise<void> {
  const { db } = deps;
  const [session] = await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId));
  if (!session) throw new DomainError("NOT_FOUND", "Session not found");
  if (session.status === "cancel_requested") {
    await finish(db, sessionId, "cancelled", null);
    return;
  }
  if (session.status !== "queued" && session.status !== "running") return;
  // Old writers must not re-evaluate newer runs (#181, stage 1): a council whose verdict came from a newer gate version
  // is failed with a clear message before any phase or model call runs – no silent downgrade to this release's gate.
  try {
    // Also checked here, not only on start: a queued council must not run on a release deployed without engine (#188).
    assertEngineInstalled();
    assertCanEvaluateSession(await sessionGateVersions(db, sessionId));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await finish(db, sessionId, "failed", error.message);
    return;
  }

  // Nothing of this session is in flight now: reservations left by calls a restart interrupted are released, so the
  // counter equals the recorded usage again (night test 07.11.26: 916,799 counted vs. 789,888 recorded after deploys).
  await reconcileTokens(db, sessionId);
  await db
    .update(schema.councilSession)
    .set({ status: "running", startedAt: session.startedAt ?? new Date(), error: null })
    .where(eq(schema.councilSession.id, sessionId));
  const ctx = new SessionContext(
    db,
    (await db.select().from(schema.councilSession).where(eq(schema.councilSession.id, sessionId)))[0]!,
    deps.transientRetryDelayMs,
  );
  await ctx.restoreOutputFloors();
  const stages = await db.select().from(schema.workflowStage).where(eq(schema.workflowStage.sessionId, sessionId));
  const random = deps.random ?? Math.random;

  for (const phase of AUTOMATIC_PHASES) {
    const stage = stages.find((s) => s.phase === phase);
    if (stage?.status === "completed" || stage?.status === "skipped") continue;
    await db.update(schema.councilSession).set({ currentPhase: phase }).where(eq(schema.councilSession.id, sessionId));
    await setStage(db, sessionId, phase, { status: "running", startedAt: new Date(), attempt: (stage?.attempt ?? 0) + 1, error: null });
    try {
      ctx.verdictReserve = phase === "final_verdict" ? 0 : await verdictReserve(ctx);
      await runPhase(ctx, deps, phase, random);
      await setStage(db, sessionId, phase, { status: "completed", completedAt: new Date() });
    } catch (error) {
      if (error instanceof DomainError && error.code === "BUDGET_EXCEEDED" && SHORTENABLE.has(phase)) {
        // Degrade instead of discarding the whole council; the next phases try with what is left.
        await setStage(db, sessionId, phase, { status: "skipped", error: SHORTENED_FOR_BUDGET, completedAt: new Date() });
        continue;
      }
      if (error instanceof CancelledError) {
        await setStage(db, sessionId, phase, { status: "cancelled", completedAt: new Date() });
        await finish(db, sessionId, "cancelled", null);
        return;
      }
      const message = error instanceof DomainError ? error.message : "Unexpected engine error";
      await setStage(db, sessionId, phase, { status: "failed", error: message, completedAt: new Date() });
      await finish(db, sessionId, "failed", message);
      if (!(error instanceof DomainError)) throw error;
      return;
    }
  }
  await reconcileTokens(db, sessionId);
  await db
    .update(schema.councilSession)
    .set({ status: "awaiting_approval", currentPhase: "final_verdict", finishedAt: new Date() })
    .where(eq(schema.councilSession.id, sessionId));
  await recordAudit(db, { organizationId: ctx.orgId, actorUserId: null, action: "council.verdict_ready", targetType: "council_session", targetId: sessionId });
}

async function runPhase(ctx: SessionContext, deps: EngineDeps, phase: CouncilPhase, random: () => number) {
  switch (phase) {
    case "independent_thinking":
      return independentThinking(ctx, deps.resolveAdapter, random);
    case "open_council":
      return openCouncil(ctx, deps.resolveAdapter);
    case "twelve_minds_council": {
      const from = ctx.session.debateRoundsRun + 1;
      const to = Math.max(from, ctx.session.debateRoundsRun === 0 ? ctx.policy.debateRounds : ctx.session.debateRoundsRun + 1);
      return twelveMindsCouncil(ctx, deps.resolveAdapter, { from, to });
    }
    case "minority_review":
      return minorityReviewPhase(ctx, deps.resolveAdapter);
    case "consensus_round":
      return consensusRound(ctx, deps.resolveAdapter);
    case "final_verdict":
      return finalVerdict(ctx, deps.resolveAdapter);
    case "execution_council":
      return;
  }
}

async function finish(db: Database, sessionId: string, status: "cancelled" | "failed", error: string | null) {
  await db.update(schema.councilSession).set({ status, error, finishedAt: new Date() }).where(eq(schema.councilSession.id, sessionId));
}

/**
 * Sets the council's token counter to its recorded usage (council phases; the Execution Council has its own budget).
 * Only called while no call of the session runs: at the start of a (resumed) run and when the verdict is ready.
 */
export async function reconcileTokens(db: Database, sessionId: string) {
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${schema.usageRecord.inputTokens} + ${schema.usageRecord.outputTokens}), 0)` })
    .from(schema.usageRecord)
    .where(and(eq(schema.usageRecord.sessionId, sessionId), sql`coalesce(${schema.usageRecord.phase}::text, '') <> 'execution_council'`));
  await db
    .update(schema.councilSession)
    .set({ tokensUsed: Number(row?.used ?? 0) })
    .where(eq(schema.councilSession.id, sessionId));
}
