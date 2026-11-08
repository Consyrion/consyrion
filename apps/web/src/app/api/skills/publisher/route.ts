import { claimPublisherHandle, getPublisherStatus } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { assertSkillHubPublishEnabled } from "@/lib/server/skillhub-flag";

/** SkillHub publisher status of the caller (#368): handle and what is still missing to publish (Pro, e-mail, age). */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json(await getPublisherStatus(await getDb(), actor));
});

/** Claims the caller's publisher handle once: { handle }. */
export const POST = handle(async (request: Request) => {
  assertSkillHubPublishEnabled();
  const actor = await requireActor();
  const body = (await readJson(request)) as { handle?: unknown } | null;
  const db = await getDb();
  await claimPublisherHandle(db, actor, body?.handle);
  return NextResponse.json(await getPublisherStatus(db, actor), { status: 201 });
});
