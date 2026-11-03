import { deleteOrganization } from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE, requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const DELETE = handle(async (request: Request) => {
  const actor = await requireActor();
  const { confirmName } = (await readJson(request)) as { confirmName?: string };
  await deleteOrganization(await getDb(), actor, String(confirmName ?? ""));
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  return new NextResponse(null, { status: 204 });
});
