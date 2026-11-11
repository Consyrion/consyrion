import { createCredential, listCredentials } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

export const GET = handle(async () => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ credentials: await listCredentials(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  const credential = await createCredential(await getDb(), actor, getKeyring(), (await readJson(request)) as never);
  return NextResponse.json({ credential }, { status: 201 });
});
