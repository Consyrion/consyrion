import { deleteAssistantChat, getAssistantChat } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { withCosts } from "@/lib/server/assistant-cost";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/** One chat with its messages – only for its owner (#280); each answer with its approximate cost (#281) and the council chat's cross-checks (#241). */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  const db = await getDb();
  const { chat, messages, checks } = await getAssistantChat(db, actor, (await params).id);
  return NextResponse.json({ chat, messages: await withCosts(db, actor, messages), checks });
});

/** Deletes the chat and its messages for good (privacy). */
export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  await deleteAssistantChat(await getDb(), actor, (await params).id);
  return NextResponse.json({ ok: true });
});
