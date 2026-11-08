import { createApiToken, listApiTokens } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ tokens: await listApiTokens(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor({ sessionOnly: true });
  const body = (await readJson(request)) as { name?: string; days?: number; scope?: string };
  // New tokens are integration tokens unless full access is asked for explicitly (#101).
  const result = await createApiToken(await getDb(), actor, { name: String(body.name ?? ""), days: Number(body.days ?? 90), scope: body.scope });
  return NextResponse.json(result, { status: 201 });
});
