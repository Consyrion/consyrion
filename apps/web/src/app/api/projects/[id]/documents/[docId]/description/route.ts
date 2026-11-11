import { DomainError } from "@consyrium/core";
import { setImageDescription } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The user confirms the (reviewed or self-written) description of an image: { text }. Only this text reaches a council. */
export const PUT = handle(async (request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) => {
  const actor = await requireActor({ integration: true });
  const { id, docId } = await params;
  const body = (await readJson(request)) as { text?: unknown };
  if (typeof body.text !== "string") throw new DomainError("VALIDATION", "Send the description as { text }");
  return NextResponse.json(await setImageDescription(await getDb(), actor, id, docId, { text: body.text, status: "confirmed" }));
});
