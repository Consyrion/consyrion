import { createDeliveryConnection, listDeliveryConnections } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

/** Telegram and Confluence connections of the workspace (#165); secrets are never returned. */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ connections: await listDeliveryConnections(await getDb(), actor), emailConfigured: Boolean(process.env.SMTP_URL?.trim()) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  const connection = await createDeliveryConnection(await getDb(), actor, getKeyring(), (await readJson(request)) as never);
  return NextResponse.json({ connection }, { status: 201 });
});
