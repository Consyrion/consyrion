import { deleteAssistantChat, getAssistantChat } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** One chat with its messages – only for its owner (#280). */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  return NextResponse.json(await getAssistantChat(await getDb(), actor, (await params).id));
});

/** Deletes the chat and its messages for good (privacy). */
export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  await deleteAssistantChat(await getDb(), actor, (await params).id);
  return NextResponse.json({ ok: true });
});
