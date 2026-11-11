import { DomainError } from "@consyrium/core";
import { toggleInterventionMark } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** Mark an objection or key dispute as important, or remove the mark (#15/#41) – no model call, no effect on the verdict. */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { targetType?: unknown; targetId?: unknown };
  const targetType = body.targetType === "crux" ? "crux" : body.targetType === "objection" ? "objection" : null;
  if (!targetType || typeof body.targetId !== "string" || !body.targetId) throw new DomainError("VALIDATION", "Choose an objection or key dispute");
  return NextResponse.json(await toggleInterventionMark(await getDb(), actor, { sessionId: (await params).id, targetType, targetId: body.targetId }));
});
