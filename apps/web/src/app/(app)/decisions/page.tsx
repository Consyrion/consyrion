import { listSessions } from "@consyrion/council";
import { DECISION_MODE_LABELS } from "@consyrion/core";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("decisions"))("metaTitle") };
}

export default async function DecisionsPage() {
  const actor = await requirePageActor();
  const sessions = await listSessions(await getDb(), actor);
  const t = await getTranslations("decisions");
  const format = await getFormatter();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {sessions.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2">
                <span>
                  <span className="font-medium">{s.projectName}</span>
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
