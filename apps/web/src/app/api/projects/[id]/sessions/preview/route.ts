import { previewSession, type SessionInput } from "@consyrium/council";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { probeModel, unusableModels } from "@/lib/server/model-catalog";

/**
 * Cost and step preview before a session starts (#57). With `?checkModels=1` every chosen model also gets the tiny
 * start check (one call of a few tokens on the user's key) and the ones the provider refuses are returned as
 * `unusableModels` – clients without a live model list (Obsidian) name them before the start instead of after it.
 */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const db = await getDb();
  const input = (await readJson(request)) as SessionInput;
  const preview = await previewSession(db, actor, (await params).id, input);
  if (new URL(request.url).searchParams.get("checkModels") !== "1") return NextResponse.json(preview);
  const participants = Array.isArray(input?.participants) ? input.participants : [];
  return NextResponse.json({
    ...preview,
    unusableModels: await unusableModels(participants, (credentialId, modelId) => probeModel(db, actor, credentialId, modelId)),
  });
});
