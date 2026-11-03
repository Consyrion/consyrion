import { DomainError } from "@consyrion/core";
import { getGitHubIntegration, getProject, listDocuments, replaceRepositoryContext, type ActorContext, type Database } from "@consyrion/db";
import { contextDocument, installationClient, readContextFiles, readRepositoryTree, suggestContextFiles, CONTEXT_LIMITS } from "@consyrion/github";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { requireGitHubConfig } from "@/lib/server/github";
import { rateLimit } from "@/lib/server/rate-limit";

/** The linked repository of a project with a read-only client scoped to it. */
async function linked(db: Database, actor: ActorContext, projectId: string) {
  const project = await getProject(db, actor, projectId);
  if (!project.githubIntegrationId || !project.repositoryFullName || !project.repositoryDefaultBranch)
    throw new DomainError("CONFLICT", "Link a GitHub repository to this project first.");
  const integration = await getGitHubIntegration(db, actor, project.githubIntegrationId);
  const client = await installationClient(requireGitHubConfig(), integration.installationId, project.repositoryFullName);
  return { project, client, repo: { fullName: project.repositoryFullName, defaultBranch: project.repositoryDefaultBranch, private: true } };
}

/**
 * Repository context for Decision councils (docs/documents.md): GET lists the readable text files of the linked
 * repository's default branch with a suggestion and the current context; POST reads the chosen files at that commit
 * into the project's one context document.
 */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  rateLimit(`repo-context:${actor.userId}`, 20, 60_000);
  const db = await getDb();
  const projectId = (await params).id;
  const { project, client, repo } = await linked(db, actor, projectId);
  const tree = await readRepositoryTree(client, repo);
  const brief = [project.brief?.idea, project.brief?.goal, project.brief?.requirements].filter(Boolean).join("\n");
  const current = (await listDocuments(db, actor, projectId)).find((d) => d.origin?.kind === "github") ?? null;
  return NextResponse.json({
    repository: repo.fullName,
    branch: repo.defaultBranch,
    commitSha: tree.commitSha,
    files: tree.files.map((f) => ({ path: f.path, size: f.size })),
    suggested: suggestContextFiles(tree.files, brief),
    limits: CONTEXT_LIMITS,
    current: current ? { id: current.id, name: current.name, sizeBytes: current.sizeBytes, origin: current.origin } : null,
  });
});

const input = z.object({ commitSha: z.string().regex(/^[0-9a-f]{7,64}$/), paths: z.array(z.string().max(500)).min(1).max(CONTEXT_LIMITS.maxFiles) });

export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  rateLimit(`repo-context:${actor.userId}`, 20, 60_000);
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) throw new DomainError("VALIDATION", "Choose at least one file");
  const db = await getDb();
  const projectId = (await params).id;
  const { client, repo } = await linked(db, actor, projectId);
  const tree = await readRepositoryTree(client, repo);
  // The user chose from one commit; a newer push in between means another list – never mix two states.
  if (tree.commitSha !== parsed.data.commitSha)
    throw new DomainError("CONFLICT", `The branch ${repo.defaultBranch} moved to a new commit since the list was loaded. Load the files again.`);
  let read;
  try {
    read = await readContextFiles(client, repo, tree, parsed.data.paths);
  } catch (error) {
    throw new DomainError("VALIDATION", error instanceof Error ? error.message : "The files could not be read");
  }
  if (read.files.length === 0) throw new DomainError("VALIDATION", "None of the chosen files could be used");
  const document = await replaceRepositoryContext(db, actor, projectId, {
    repository: repo.fullName,
    branch: repo.defaultBranch,
    commitSha: tree.commitSha,
    paths: read.files.map((f) => f.path),
    skipped: read.skipped,
    content: contextDocument(repo, tree, read.files),
  });
  return NextResponse.json({ document, skipped: read.skipped }, { status: 201 });
});
