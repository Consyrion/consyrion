import { listSessions } from "@consyrium/council";
import { DECISION_MODE_LABELS } from "@consyrium/core";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ListFilter, matchesQuery } from "@/components/list-filter";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("decisions"))("metaTitle") };
}

/** Status chips in this order; a status with no session is left out. "live" groups queued, running and stopping. */
const STATUS_ORDER = ["awaiting_approval", "running", "approved", "changes_requested", "rejected", "failed", "cancelled"] as const;
const LIVE = new Set(["queued", "running", "cancel_requested"]);
const statusGroup = (status: string) => (LIVE.has(status) ? "running" : status);

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ archived?: string; q?: string; status?: string }> }) {
  const actor = await requirePageActor();
  const all = await listSessions(await getDb(), actor);
  const params = await searchParams;
  // #197: sessions of archived projects are hidden unless asked for – not deleted, still reachable.
  const showArchived = params.archived === "1";
  const archivedCount = all.filter((s) => s.projectStatus === "archived").length;
  const listed = showArchived ? all : all.filter((s) => s.projectStatus !== "archived");
  // QA 12.11.26: search and status filter; the chip counts follow the search, so a count always matches the list.
  const query = (params.q ?? "").trim();
  const status = params.status ?? "";
  const searched = listed.filter((s) => matchesQuery(query, s.projectName, DECISION_MODE_LABELS[s.mode]));
  const sessions = status ? searched.filter((s) => statusGroup(s.status) === status) : searched;
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
      {listed.length > 0 ? (
        <ListFilter
          basePath="/decisions"
          query={query}
          queryLabel={t("filter.search")}
          submitLabel={t("filter.submit")}
          active={status}
          keep={showArchived ? { archived: "1" } : {}}
          chips={[
            { value: "", label: t("filter.all"), count: searched.length },
            ...STATUS_ORDER.map((st) => ({ value: st, label: t(`status.${st}`), count: searched.filter((s) => statusGroup(s.status) === st).length })).filter(
              (c) => c.count > 0 || c.value === status,
            ),
          ]}
          shown={query || status ? t("filter.shown", { n: sessions.length, of: listed.length }) : null}
        />
      ) : null}
      {listed.length > 0 && sessions.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-muted">{t("filter.none")}</p>
      ) : sessions.length === 0 ? (
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
