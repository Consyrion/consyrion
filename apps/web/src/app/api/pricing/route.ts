import { listPriceHints, setPriceHint } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json({ hints: await listPriceHints(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  await setPriceHint(await getDb(), actor, (await readJson(request)) as never);
  return NextResponse.json({ ok: true }, { status: 201 });
});
