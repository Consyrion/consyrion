import { listSessions } from "@consyrion/council";
import { can, DECISION_MODE_LABELS, DomainError } from "@consyrion/core";
import { getEntitlements, getProject, latestRequirementList, listDocuments, listGitHubIntegrations, requirementSourceState } from "@consyrion/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/document-upload";
import { RepositoryContext } from "@/components/repository-context";
import { RepositoryLink } from "@/components/repository-link";
import { DangerDelete } from "@/components/saas";
import { PhaseOverview } from "@/components/phase-overview";
import { buttonClasses } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { githubConfig } from "@/lib/server/github";

const INTENT: Record<string, string> = { decision: "Decision only", build: "Development", both: "Decision and development" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const project = await getProject(await getDb(), actor, (await params).id).catch(() => null);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const db = await getDb();
  const project = await getProject(db, actor, (await params).id).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [documents, sessions, integrations, { entitlements }, requirementList, source] = await Promise.all([
    listDocuments(db, actor, project.id),
    listSessions(db, actor, project.id),
    listGitHubIntegrations(db, actor),
    getEntitlements(db, actor.organizationId),
    latestRequirementList(db, actor, project.id),
    requirementSourceState(db, actor, project.id).catch(() => null),
  ]);
  // Requirement intake (#190): a council starts only on a list confirmed for the current brief and documents.
  const requirementsCurrent = Boolean(requirementList && source && requirementList.sourceHash === source.hash);
  const brief = project.brief;
  const canRun = can(actor.role, "decision:run") && project.status !== "archived";

  return (
    <>
      <PageHeader
        title={project.name}
        description={`Brief version ${brief?.version ?? "–"} · ${INTENT[project.intent] ?? project.intent}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge>{project.status}</Badge>
            {canRun ? (
              <Link href={`/projects/${project.id}/council/new`} className={buttonClasses()}>
                Start a council
              </Link>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="font-semibold">Project brief</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-muted">Idea or question</dt>
              <dd className="mt-1 whitespace-pre-wrap">{brief?.idea}</dd>
            </div>
            {brief?.goal ? (
              <div>
                <dt className="text-muted">Desired outcome</dt>
                <dd className="mt-1 whitespace-pre-wrap">{brief.goal}</dd>
              </div>
            ) : null}
            {brief?.requirements ? (
              <div>
                <dt className="text-muted">Requirements</dt>
                <dd className="mt-1 whitespace-pre-wrap">{brief.requirements}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Confirmed hard requirements</dt>
              <dd className="mt-1">
                {requirementList ? (
                  <span className="flex flex-wrap items-center gap-2">
                    Version {requirementList.version} · {requirementList.items.length} requirement(s)
                    {requirementList.excluded.length ? ` · ${requirementList.excluded.length} not taken over` : ""}
                    <Badge tone={requirementsCurrent ? "success" : "warning"}>{requirementsCurrent ? "current" : "needs confirmation again"}</Badge>
                  </span>
                ) : (
                  <Badge tone="warning">not confirmed yet</Badge>
                )}
                {canRun && !requirementsCurrent ? (
                  <Link href={`/projects/${project.id}/council/new`} className="ml-2 text-primary hover:underline">
                    Review and confirm
                  </Link>
                ) : null}
              </dd>
            </div>
            {brief?.repositoryUrl ? (
              <div>
                <dt className="text-muted">Repository</dt>
                <dd className="mt-1 break-all">{brief.repositoryUrl}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
        <Card>
          <h2 className="font-semibold">Documents</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Attached documents become part of the brief for every new council session.</p>
          <DocumentUpload projectId={project.id} initial={documents} canWrite={can(actor.role, "project:write")} />
          <h2 className="mt-6 font-semibold">GitHub repository</h2>
          <div className="mt-2">
            <RepositoryLink
              projectId={project.id}
              linked={project.repositoryFullName}
              githubAllowed={entitlements.github}
              integrations={integrations.map((i) => ({ id: i.id, accountLogin: i.accountLogin }))}
              canWrite={can(actor.role, "project:write")}
              githubConfigured={Boolean(githubConfig())}
            />
          </div>
          {project.repositoryFullName && githubConfig() ? (
            <>
              <h2 className="mt-6 font-semibold">Repository context for councils</h2>
              <div className="mt-2">
                <RepositoryContext projectId={project.id} canWrite={can(actor.role, "project:write")} />
              </div>
            </>
          ) : null}
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">Council sessions</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No sessions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-primary">
                  <span>{DECISION_MODE_LABELS[s.mode]}</span>
                  <span className="flex items-center gap-2">
                    <Badge>{s.status.replaceAll("_", " ")}</Badge>
                    <span className="text-xs text-muted">{s.createdAt.toLocaleString("en-GB")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">Phases</h2>
        <PhaseOverview />
      </Card>
      {can(actor.role, "project:delete") ? (
        <Card className="mt-6 border-danger/40">
          <h2 className="font-semibold text-danger">Delete project</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Permanently deletes the project with all council sessions, decisions, generated code and documents.</p>
          <DangerDelete url={`/api/projects/${project.id}/delete`} method="POST" name={project.name} label="Delete project permanently" redirectTo="/projects" />
        </Card>
      ) : null}
    </>
  );
}
