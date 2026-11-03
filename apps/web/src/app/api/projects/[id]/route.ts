import { archiveProject, getProject, updateBrief } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ project: await getProject(await getDb(), actor, (await params).id) });
});

/** Updating a project always appends a new brief version. */
export const PATCH = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  const brief = await updateBrief(await getDb(), actor, (await params).id, (await readJson(request)) as never);
  return NextResponse.json({ brief });
});

export const DELETE = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor();
  await archiveProject(await getDb(), actor, (await params).id);
  return new NextResponse(null, { status: 204 });
});
