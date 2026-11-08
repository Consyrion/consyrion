import { can } from "@consyrion/core";
import { ensureDemoProject, listProjects } from "@consyrion/db";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("projects"))("metaTitle") };
}

export default async function ProjectsPage() {
  const actor = await requirePageActor();
  // Owner decision 08.11.26: every workspace gets one read-only demo project the first time it opens the app.
  await ensureDemoProject(await getDb(), actor, await getLocale());
  const all = await listProjects(await getDb(), actor);
  const projects = all.filter((p) => p.status !== "archived");
  // #197: archived projects are not lost – they are listed below in their own section.
  const archived = all.filter((p) => p.status === "archived");
  const t = await getTranslations("projects");
  const format = await getFormatter();
  const canWrite = can(actor.role, "project:write");
  const newButton = canWrite ? (
    <Link href="/projects/new" className={buttonClasses()}>
      {t("new")}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={newButton} />
      {projects.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} action={newButton} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                <span className="font-medium">{project.name}</span>
                <span className="flex items-center gap-2">
                  {project.isDemo ? <Badge tone="warning">{t("demoBadge")}</Badge> : null}
                  <Badge tone="accent">{t.has(`type.${project.type}`) ? t(`type.${project.type}`) : project.type}</Badge>
                  <Badge>{t.has(`status.${project.status}`) ? t(`status.${project.status}`) : project.status}</Badge>
                  <time className="text-xs text-muted" dateTime={project.updatedAt.toISOString()}>
                    {format.dateTime(project.updatedAt, { dateStyle: "short" })}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {archived.length ? (
        <details className="mt-6 rounded-xl border border-line bg-surface" data-testid="archived-projects">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium">{t("archive.listTitle", { n: archived.length })}</summary>
          <ul className="divide-y divide-line border-t border-line">
            {archived.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-2">
                  <span>{project.name}</span>
                  <time className="text-xs text-muted" dateTime={project.updatedAt.toISOString()}>
                    {format.dateTime(project.updatedAt, { dateStyle: "short" })}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
