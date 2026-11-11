import { listSessions } from "@consyrium/council";
import { DECISION_MODE_LABELS } from "@consyrium/core";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("decisions"))("metaTitle") };
}

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const actor = await requirePageActor();
  const all = await listSessions(await getDb(), actor);
  // #197: sessions of archived projects are hidden unless asked for – not deleted, still reachable.
  const showArchived = (await searchParams).archived === "1";
  const archivedCount = all.filter((s) => s.projectStatus === "archived").length;
  const sessions = showArchived ? all : all.filter((s) => s.projectStatus !== "archived");
  const t = await getTranslations("decisions");
  const format = await getFormatter();
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          // #182: how the councils of this workspace worked – figures only.
          <Link href="/decisions/quality" className="text-sm text-primary underline" data-testid="quality-link">
            {t("qualityLink")}
          </Link>
        }
      />
      {archivedCount ? (
        <p className="mb-3 text-sm">
          <Link href={showArchived ? "/decisions" : "/decisions?archived=1"} className="text-primary underline" data-testid="archived-filter">
            {showArchived ? t("hideArchived") : t("showArchived", { n: archivedCount })}
          </Link>
        </p>
      ) : null}
      {sessions.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                <span>
                  <span className="font-medium">{s.projectName}</span>
                  {s.projectStatus === "archived" ? <Badge tone="warning">{t("archivedBadge")}</Badge> : null}
                  <span className="block text-sm text-muted">{DECISION_MODE_LABELS[s.mode]}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge>{t.has(`status.${s.status}`) ? t(`status.${s.status}`) : s.status.replaceAll("_", " ")}</Badge>
                  <span className="text-xs text-muted">{format.dateTime(s.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
