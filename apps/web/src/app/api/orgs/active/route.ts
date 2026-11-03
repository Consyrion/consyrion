import { resolveActor } from "@consyrion/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE, requireUser } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Switches the active workspace; membership is verified before the preference is stored. */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  const { organizationId } = (await readJson(request)) as { organizationId?: string };
  await resolveActor(await getDb(), user.id, String(organizationId ?? ""));
  (await cookies()).set(ACTIVE_ORG_COOKIE, String(organizationId), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return NextResponse.json({ ok: true });
});
