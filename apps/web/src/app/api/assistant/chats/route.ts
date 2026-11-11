import { listAssistantChats } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The signed-in user's assistant chats in this workspace (#280), newest first. */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ chats: await listAssistantChats(await getDb(), actor) });
});
