import { DomainError } from "@consyrium/core";
import { listInterventions } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { onceAtATime } from "@/lib/server/in-flight";
import { previewIntervention, runIntervention } from "@/lib/server/interventions";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/** The human interventions of a session with the models' answers (#15/#41) – an appendix, never part of the verdict. */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  return NextResponse.json({ interventions: await listInterventions(await getDb(), actor, (await params).id) });
});

/**
 * Ask the council after the verdict (#15/#41 stage 1). Body { kind: "question" | "statement_request", targetType:
 * "session" | "objection", targetId?, text, preview?, confirmCosts? }. preview: true → which models answer and the
 * estimated tokens (no call). Otherwise the costs must be confirmed; each asked model answers once, at most 30,000
 * tokens per intervention, 10 per hour. Nothing is written into the debate, scores, votes, checks or the verdict.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const sessionId = (await params).id;
  const body = (await readJson(request)) as {
    kind?: unknown;
    targetType?: unknown;
    targetId?: unknown;
    text?: unknown;
    preview?: unknown;
    confirmCosts?: unknown;
  };
  const kind = body.kind === "statement_request" ? "statement_request" : body.kind === "question" ? "question" : null;
  if (!kind) throw new DomainError("VALIDATION", "kind must be question or statement_request");
  const targetType = kind === "question" ? "session" : "objection";
  const input = {
    kind,
    targetType,
    targetId: typeof body.targetId === "string" ? body.targetId : null,
    text: typeof body.text === "string" ? body.text.trim() : "",
  } as const;
  const db = await getDb();
  if (body.preview === true) return NextResponse.json(await previewIntervention(db, actor, sessionId, input));
  if (body.confirmCosts !== true) throw new DomainError("VALIDATION", "Confirm the costs – the answers use tokens on your own keys");
  rateLimit(`intervention:${actor.userId}`, 10, 60 * 60_000);
  return onceAtATime(`intervention:${actor.userId}:${sessionId}`, async () =>
    NextResponse.json(await runIntervention(db, actor, sessionId, input, request.signal), { status: 201 }),
  );
});
