import { createProject, listProjects, type ProjectInput } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { autoLinkRepository } from "@/lib/server/github";

export const GET = handle(async () => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ projects: await listProjects(await getDb(), actor) });
});

export const POST = handle(async (request: Request) => {
  const actor = await requireActor({ integration: true });
  const db = await getDb();
  const input = (await readJson(request)) as ProjectInput;
  const project = await createProject(db, actor, input);
  const repositoryLinked = await autoLinkRepository(db, actor, project.id, input?.brief?.repositoryUrl);
  return NextResponse.json({ project, repositoryLinked }, { status: 201 });
});
