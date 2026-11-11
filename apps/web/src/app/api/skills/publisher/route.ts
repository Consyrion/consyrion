import { claimPublisherHandle, getPublisherStatus, setPublisherDisplayName } from "@consyrium/db";
import { NextResponse } from "next/server";
import { getSessionUser, requireActor } from "@/lib/server/actor";
import { isPlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { assertSkillHubPublishEnabled } from "@/lib/server/skillhub-flag";

/** SkillHub publisher status of the caller (#368): handle, public name and what is still missing to publish. */
export const GET = handle(async () => {
  const actor = await requireActor();
  return NextResponse.json(await getPublisherStatus(await getDb(), actor, new Date(), { platformAdmin: isPlatformAdmin(await getSessionUser()) }));
});

/**
 * Claims the caller's publisher handle once and/or sets the optional public name: { handle?, displayName? }.
 * Reserved names (e.g. `@consyrium-team`, "CONSYRIUM Team") are allowed only for platform admins.
 */
export const POST = handle(async (request: Request) => {
  assertSkillHubPublishEnabled();
  const actor = await requireActor({ sessionOnly: true });
  const allowReserved = isPlatformAdmin(await getSessionUser());
  const body = ((await readJson(request)) ?? {}) as { handle?: unknown; displayName?: unknown };
  const db = await getDb();
  if (body.handle !== undefined) await claimPublisherHandle(db, actor, body.handle, { allowReserved });
  if (body.displayName !== undefined) await setPublisherDisplayName(db, actor, body.displayName, { allowReserved });
  return NextResponse.json(await getPublisherStatus(db, actor, new Date(), { platformAdmin: allowReserved }), { status: 201 });
});
