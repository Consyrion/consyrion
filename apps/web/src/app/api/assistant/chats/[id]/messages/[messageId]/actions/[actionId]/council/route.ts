import { createHash } from "node:crypto";
import { createSession, previewSession, type SessionInput } from "@consyrium/council";
import { DomainError } from "@consyrium/core";
import {
  assertCurrentRequirementList,
  beginIdempotency,
  completeCouncilStartAction,
  completeIdempotency,
  getAssistantAction,
  getProject,
  lastCouncilParticipants,
  releaseIdempotency,
} from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { modelCatalog } from "@/lib/server/model-catalog";
import { onceAtATime } from "@/lib/server/in-flight";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string; messageId: string; actionId: string }> };

/**
 * Council start from the assistant's card (#215 stage 2) – the same services as the council form.
 * Body { preview: true } → the cost preview (models of the last council, mode, budget, upper bound, plan limit,
 * warnings) and a `previewHash`; nothing is started. Body { confirmCosts: true, previewHash } → everything is checked
 * again (brief, confirmed requirement list, keys, plan quota, budget); if anything changed since the preview the start is
 * refused with the new preview. Then exactly one council starts (idempotency key per card, also for a double click) and
 * the card shows the session. The model can only suggest the card – starting needs the user's checkbox and click.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const ids = await params;
  const body = (await readJson(request).catch(() => ({}))) as { preview?: unknown; confirmCosts?: unknown; previewHash?: unknown };
  const db = await getDb();
  const action = await getAssistantAction(db, actor, { chatId: ids.id, messageId: ids.messageId, actionId: ids.actionId });
  if (action.type !== "start_council") throw new DomainError("NOT_FOUND", "Action not found");
  if (action.status === "executed") return NextResponse.json({ action });
  if (action.status !== "proposed") throw new DomainError("CONFLICT", "This action was dismissed");

  const projectId = String(action.params.projectId);
  const project = await getProject(db, actor, projectId);
  const participants = (await lastCouncilParticipants(db, actor)).map((p) => ({ credentialId: p.credentialId!, modelId: p.modelId }));
  if (participants.length < 2)
    throw new DomainError("VALIDATION", "Start your first council from the council form – the card uses the models of the last council");
  const input: SessionInput = {
    mode: "independent_expert",
    participants,
    ...(typeof action.params.tokenBudget === "number" ? { tokenBudget: action.params.tokenBudget } : {}),
  };
  const requirements = await assertCurrentRequirementList(db, actor, projectId).then(
    (r) => ({ current: true as const, version: r.list.version, briefId: r.state.briefId }),
    (error: unknown) => {
      if (error instanceof DomainError) return { current: false as const, message: error.message };
      throw error;
    },
  );
  const preview = await previewSession(db, actor, projectId, input);
  const summary = {
    project: { id: project.id, name: project.name },
    mode: input.mode,
    models: participants.map((p) => p.modelId),
    tokenBudget: preview.policy.tokenBudget,
    upperBound: preview.estimate.upperBound,
    minimumBudget: preview.estimate.minimumBudget,
    typical: preview.estimate.typical?.tokens ?? null,
    shortened: preview.estimate.upperBound > preview.policy.tokenBudget,
    planLimit: preview.planLimit,
    finalVerdict: preview.finalVerdictSize.message,
    modelWarnings: preview.modelWarnings,
    requirements: requirements.current ? { current: true, version: requirements.version } : { current: false, message: requirements.message },
  };
  // Everything a confirmation refers to – a change between preview and click needs a new confirmation (TOCTOU).
  const previewHash = createHash("sha256")
    .update(
      JSON.stringify({
        input,
        budget: summary.tokenBudget,
        upper: summary.upperBound,
        requirements: requirements.current ? [requirements.version, requirements.briefId] : null,
      }),
    )
    .digest("hex")
    .slice(0, 32);
  const startable = requirements.current && !summary.planLimit && preview.finalVerdictSize.fits && summary.tokenBudget >= summary.minimumBudget;
  if (body.preview === true) return NextResponse.json({ preview: { ...summary, startable }, previewHash });

  rateLimit(`assistant-council:${actor.userId}`, 5, 60_000);
  if (body.confirmCosts !== true) throw new DomainError("VALIDATION", "Confirm the costs to start the council");
  if (body.previewHash !== previewHash)
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Something changed since the preview – check the costs again." }, preview: { ...summary, startable }, previewHash },
      { status: 409 },
    );
  if (!startable)
    throw new DomainError(
      "CONFLICT",
      summary.planLimit ?? (requirements.current ? (summary.finalVerdict ?? "This council cannot start") : requirements.message),
    );

  return onceAtATime(`assistant-council:${actor.userId}:${action.id}`, async () => {
    const reservation = await beginIdempotency(db, actor, `assistant-card:${action.id}`, previewHash);
    let sessionId: string;
    if (reservation.state === "replay") sessionId = reservation.sessionId;
    else {
      try {
        sessionId = (await createSession(db, actor, projectId, { ...input, confirmBudget: true }, modelCatalog(db, actor))).id;
        await completeIdempotency(db, reservation.id, sessionId);
      } catch (error) {
        await releaseIdempotency(db, reservation.id);
        throw error;
      }
    }
    const done = await completeCouncilStartAction(
      db,
      actor,
      { chatId: ids.id, messageId: ids.messageId, actionId: action.id },
      {
        sessionId,
        label: project.name,
        tokenBudget: summary.tokenBudget,
      },
    );
    return NextResponse.json({ action: done, sessionId }, { status: 201 });
  });
});
