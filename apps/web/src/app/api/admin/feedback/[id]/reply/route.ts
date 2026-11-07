import { replyToFeedback } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Body { text }: an answer the author sees under "My reports" (platform admin only, #295). */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await requirePlatformAdminContext();
  const body = (await readJson(request)) as { text?: unknown };
  const reply = await replyToFeedback(await getDb(), admin, (await params).id, typeof body.text === "string" ? body.text : "");
  return NextResponse.json({ id: reply.id, createdAt: reply.createdAt }, { status: 201 });
});
