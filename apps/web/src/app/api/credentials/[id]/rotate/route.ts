import { rotateCredential } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  const { secret } = (await readJson(request)) as { secret?: string };
  await rotateCredential(await getDb(), actor, getKeyring(), (await params).id, String(secret ?? ""));
  return NextResponse.json({ ok: true });
});
