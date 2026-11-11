import { decideAssistantAction } from "@consyrium/db";
import { DomainError } from "@consyrium/core";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string; messageId: string; actionId: string }> };

/**
 * Run or dismiss one action the assistant suggested (#283). Body { decision: "execute" | "dismiss", params? }.
 * The user's click is the only trigger; the server checks the allowlist, the parameters and the user's permissions
 * again and records "suggested by the AI assistant, confirmed by the user" in the audit log.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor();
  rateLimit(`assistant-action:${actor.userId}`, 30, 60_000);
  const body = (await readJson(request)) as { decision?: unknown; params?: unknown };
  if (body.decision !== "execute" && body.decision !== "dismiss") throw new DomainError("VALIDATION", "decision must be execute or dismiss");
  const { id, messageId, actionId } = await params;
  const action = await decideAssistantAction(await getDb(), actor, {
    chatId: id,
    messageId,
    actionId,
    decision: body.decision,
    params: body.params && typeof body.params === "object" ? body.params : undefined,
  });
  return NextResponse.json({ action });
});
