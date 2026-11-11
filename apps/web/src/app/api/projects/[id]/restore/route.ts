import { restoreProject } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** #197 (ADR 0197): brings an archived project back (role project:delete; the plan's project limit applies). */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  await restoreProject(await getDb(), actor, (await params).id);
  return new NextResponse(null, { status: 204 });
});
