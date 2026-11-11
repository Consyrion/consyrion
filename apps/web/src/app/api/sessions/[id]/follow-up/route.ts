import { previewFollowUp, startFollowUp } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

/** #228/#229: what a follow-up round would ask and cost (no model call). Owners and admins only. */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  return NextResponse.json(await previewFollowUp(await getDb(), actor, (await params).id));
});

/**
 * Starts a follow-up round after the owner's click: `{ kind: "completion" | "targeted_review", tokenBudget, confirmBudget: true }`.
 * The extra budget is added to the council's budget; it costs tokens on the workspace's own keys.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`follow-up:${actor.userId}`, 5, 60_000);
  const body = (await readJson(request)) as { kind?: unknown; tokenBudget?: unknown; confirmBudget?: unknown };
  const result = await startFollowUp(await getDb(), actor, (await params).id, {
    kind: body.kind as "completion",
    tokenBudget: Number(body.tokenBudget),
    confirmBudget: body.confirmBudget === true,
  });
  return NextResponse.json(result, { status: 201 });
});
