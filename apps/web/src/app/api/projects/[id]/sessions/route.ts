import { createSession, listSessions, type SessionInput } from "@consyrion/council";
import { beginIdempotency, completeIdempotency, idempotencyRequestHash, releaseIdempotency } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { modelCatalog } from "@/lib/server/model-catalog";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ sessions: await listSessions(await getDb(), actor, (await params).id) });
});

/**
 * Starts a council. The run is asynchronous: 201 returns the queued session id; progress via GET /sessions/:id or the
 * events stream. With an Idempotency-Key header (#101) a repeated request returns the same session (200, replayed).
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  rateLimit(`session-start:${actor.userId}`, 10, 60_000);
  const db = await getDb();
  const projectId = (await params).id;
  const input = (await readJson(request)) as SessionInput;
  const key = request.headers.get("idempotency-key");
  const reservation = key ? await beginIdempotency(db, actor, key, idempotencyRequestHash(`POST /projects/${projectId}/sessions`, input)) : null;
  if (reservation?.state === "replay") return NextResponse.json({ session: { id: reservation.sessionId }, replayed: true });
  try {
    // Model ids are checked against the live list of each selected key before anything runs (#144).
    const session = await createSession(db, actor, projectId, input, modelCatalog(db, actor));
    if (reservation) await completeIdempotency(db, reservation.id, session.id);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (reservation) await releaseIdempotency(db, reservation.id);
    throw error;
  }
});
