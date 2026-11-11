import { listSessions } from "@consyrium/council";
import { can, DECISION_MODE_LABELS, DomainError } from "@consyrium/core";
import { getEntitlements, getProject, latestRequirementList, listDocuments, listGitHubIntegrations, requirementSourceState } from "@consyrium/db";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentUpload } from "@/components/document-upload";
import { RepositoryContext } from "@/components/repository-context";
import { RepositoryLink } from "@/components/repository-link";
import { DangerDelete } from "@/components/saas";
import { DeletionNotice } from "@/components/deletion-notice";
import { ProjectArchive } from "@/components/project-archive";
import { PhaseOverview } from "@/components/phase-overview";
import { ProjectOverview } from "@/components/project-overview";
import { buttonClasses } from "@/components/ui/button";
import { DemoNotice } from "@/components/demo-notice";
import { Badge, Card, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { githubConfig } from "@/lib/server/github";
import { loadProjectOverview } from "@/lib/server/project-overview";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const project = await getProject(await getDb(), actor, (await params).id).catch(() => null);
  return { title: project?.name ?? (await getTranslations("projects"))("fallbackTitle") };
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string }> }) {
  const actor = await requirePageActor();
  const t = await getTranslations("projects");
  const tStatus = await getTranslations("decisions.status");
  const format = await getFormatter();
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
  const canRun = can(actor.role, "decision:run") && project.status !== "archived" && !project.isDemo;
  // Project overview (owner request 08.11.26): council graphic of the newest session, a chosen one or all sessions.
  const overview = await loadProjectOverview(db, actor, sessions, (await searchParams).session);

  return (
    <>
      <PageHeader
        title={project.name}
        description={t("briefLine", {
          version: String(brief?.version ?? "–"),
          intent: t.has(`intent.${project.intent}`) ? t(`intent.${project.intent}`) : project.intent,
        })}
        actions={
          <div className="flex items-center gap-2">
            <Badge>{t.has(`status.${project.status}`) ? t(`status.${project.status}`) : project.status}</Badge>
            {canRun ? (
              <Link href={`/projects/${project.id}/council/new`} className={buttonClasses()}>
                {t("startCouncil")}
              </Link>
            ) : project.status === "archived" && can(actor.role, "decision:run") ? (
              // #548: say why there is no start – and where to restore.
              <a href="#project-archive" className={buttonClasses("secondary")} title={t("archive.startBlocked")} data-testid="archived-start">
                {t("archive.startBlocked")}
              </a>
            ) : null}
          </div>
        }
      />
      {project.status === "archived" ? (
        <div className="mb-4 rounded-lg border border-warning/40 bg-surface-2 px-4 py-3 text-sm text-warning" role="status" data-testid="archived-banner">
          {t("archive.banner")}
        </div>
      ) : null}
      {project.isDemo ? <DemoNotice /> : null}
      <ProjectOverview
        project={project}
        overview={overview}
        sessions={sessions}
        requirementList={requirementList}
        canRun={canRun}
        archived={project.status === "archived"}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="font-semibold">{t("brief")}</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-muted">{t("idea")}</dt>
              <dd className="mt-1 whitespace-pre-wrap">{brief?.idea}</dd>
            </div>
            {brief?.goal ? (
              <div>
                <dt className="text-muted">{t("goal")}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{brief.goal}</dd>
              </div>
            ) : null}
            {brief?.requirements ? (
              <div>
                <dt className="text-muted">{t("requirements")}</dt>
                <dd className="mt-1 whitespace-pre-wrap">{brief.requirements}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">{t("confirmed")}</dt>
              <dd className="mt-1">
                {requirementList ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {t("listVersion", { version: requirementList.version, n: requirementList.items.length })}
                    {requirementList.excluded.length ? ` · ${t("notTakenOver", { n: requirementList.excluded.length })}` : ""}
                    <Badge tone={requirementsCurrent ? "success" : "warning"}>{requirementsCurrent ? t("current") : t("needsAgain")}</Badge>
                  </span>
                ) : (
                  <Badge tone="warning">{t("notConfirmed")}</Badge>
                )}
                {canRun && !requirementsCurrent ? (
                  <Link href={`/projects/${project.id}/council/new`} className="ml-2 text-primary hover:underline">
                    {t("reviewConfirm")}
                  </Link>
                ) : null}
              </dd>
            </div>
            {brief?.repositoryUrl ? (
              <div>
                <dt className="text-muted">{t("repository")}</dt>
                <dd className="mt-1 break-all">{brief.repositoryUrl}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
        <Card>
          <h2 className="font-semibold">{t("documents")}</h2>
          <p className="mb-3 mt-1 text-sm text-muted">{t("documentsText")}</p>
          <DocumentUpload projectId={project.id} initial={documents} canWrite={can(actor.role, "project:write")} />
          <h2 className="mt-6 font-semibold">{t("github")}</h2>
          <div className="mt-2">
            <RepositoryLink
              projectId={project.id}
              linked={project.repositoryFullName}
              requestedUrl={brief?.repositoryUrl ?? null}
              githubAllowed={entitlements.github}
              integrations={integrations.map((i) => ({ id: i.id, accountLogin: i.accountLogin }))}
              canWrite={can(actor.role, "project:write")}
              githubConfigured={Boolean(githubConfig())}
            />
          </div>
          {project.repositoryFullName && githubConfig() ? (
            <>
              <h2 className="mt-6 font-semibold">{t("repoContext")}</h2>
              <div className="mt-2">
                <RepositoryContext
                  projectId={project.id}
                  canWrite={can(actor.role, "project:write")}
                  initial={(() => {
                    // #242: the saved repository context is shown right away, without reading the repository first.
                    const doc = documents.find((d) => d.origin?.kind === "github");
                    return doc && doc.origin?.kind === "github"
                      ? {
                          id: doc.id,
                          sizeBytes: doc.sizeBytes,
                          repository: doc.origin.repository,
                          branch: doc.origin.branch,
                          commitSha: doc.origin.commitSha,
                          paths: doc.origin.paths,
                        }
                      : null;
                  })()}
                />
              </div>
            </>
          ) : null}
        </Card>
      </div>
      <Card className="mt-6">
        <h2 className="font-semibold">{t("sessions")}</h2>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("noSessions")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-primary">
                  <span>{DECISION_MODE_LABELS[s.mode]}</span>
                  <span className="flex items-center gap-2">
                    <Badge>{tStatus.has(s.status) ? tStatus(s.status) : s.status.replaceAll("_", " ")}</Badge>
                    <span className="text-xs text-muted">{format.dateTime(s.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mt-6">
        <h2 className="mb-3 font-semibold">{t("phases")}</h2>
        <PhaseOverview />
      </Card>
      {can(actor.role, "project:delete") && !project.isDemo ? (
        <Card className="mt-6 scroll-mt-20" id="project-archive">
          <h2 className="font-semibold">{project.status === "archived" ? t("archive.restoreTitle") : t("archive.title")}</h2>
          <div className="mt-2">
            <ProjectArchive projectId={project.id} archived={project.status === "archived"} />
          </div>
        </Card>
      ) : null}
      {can(actor.role, "project:delete") ? (
        <Card className="mt-6 border-danger/40">
          <h2 className="font-semibold text-danger">{t("delete")}</h2>
          <p className="mt-1 text-sm text-muted">{t("deleteText")}</p>
          {/* #197 (ADR 0197): what is deleted, counted from this project – and what CONSYRIUM cannot delete. */}
          <p className="mt-2 text-sm" data-testid="delete-counts">
            {t("deleteCounts", {
              sessions: sessions.length,
              running: sessions.filter((x) => x.status === "queued" || x.status === "running").length,
              documents: documents.length,
            })}
          </p>
          <DeletionNotice scope="project" />
          <DangerDelete url={`/api/projects/${project.id}/delete`} method="POST" name={project.name} label={t("deleteButton")} redirectTo="/projects" />
        </Card>
      ) : null}
    </>
  );
}
