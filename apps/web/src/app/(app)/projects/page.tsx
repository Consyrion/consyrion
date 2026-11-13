import { can } from "@consyrium/core";
import { ensureDemoProject, listProjects } from "@consyrium/db";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { ListFilter, matchesQuery } from "@/components/list-filter";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("projects"))("metaTitle") };
}

const TYPE_ORDER = ["idea", "architecture", "repository", "business", "technology_choice"] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const actor = await requirePageActor();
  const params = await searchParams;
  // Owner decision 08.11.26: every workspace gets one read-only demo project the first time it opens the app.
  await ensureDemoProject(await getDb(), actor, await getLocale());
  const all = await listProjects(await getDb(), actor);
  const active = all.filter((p) => p.status !== "archived");
  // QA 12.11.26: search by name and filter by project type (the chip parameter is called status for all list pages).
  const query = (params.q ?? "").trim();
  const type = params.status ?? "";
  const searched = active.filter((p) => matchesQuery(query, p.name));
  const projects = type ? searched.filter((p) => p.type === type) : searched;
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
      {active.length > 0 ? (
        <ListFilter
          basePath="/projects"
          query={query}
          queryLabel={t("filter.search")}
          submitLabel={t("filter.submit")}
          active={type}
          chips={[
            { value: "", label: t("filter.all"), count: searched.length },
            ...TYPE_ORDER.map((ty) => ({ value: ty, label: t(`type.${ty}`), count: searched.filter((p) => p.type === ty).length })).filter(
              (c) => c.count > 0 || c.value === type,
            ),
          ]}
          shown={query || type ? t("filter.shown", { n: projects.length, of: active.length }) : null}
        />
      ) : null}
      {active.length > 0 && projects.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-muted">{t("filter.none")}</p>
      ) : projects.length === 0 ? (
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
