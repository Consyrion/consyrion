import { workspaceProcessQuality } from "@consyrium/council";
import { DECISION_MODE_LABELS } from "@consyrium/core";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("processQualityOverview"))("title") };
}

/**
 * #182 PR 2 – process quality of this workspace's recent councils: figures only, from stored data. Readers of the
 * workspace see it; no other workspace's data, no content, no platform-wide statistics.
 */
export default async function ProcessQualityPage() {
  const actor = await requirePageActor();
  const { councils, summary } = await workspaceProcessQuality(await getDb(), actor);
  const t = await getTranslations("processQualityOverview");
  const tq = await getTranslations("processQuality");
  const format = await getFormatter();
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/decisions" className="text-sm text-primary underline">
            {t("back")}
          </Link>
        }
      />
      {!summary ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <>
          <Card>
            <h2 className="font-semibold">{t("summaryTitle", { n: summary.councils })}</h2>
            <ul className="mt-2 space-y-1 text-sm" data-testid="quality-summary">
              <li>{t("summary.participation", { full: summary.fullParticipation, n: summary.councils })}</li>
              <li>
                {t("summary.convergence", {
                  strong: summary.convergence.strong,
                  moderate: summary.convergence.moderate,
                  little: summary.convergence.little,
                  none: summary.convergence.notMeasurable,
                })}
              </li>
              <li>
                {summary.objections.total
                  ? t("summary.objections", {
                      total: summary.objections.total,
                      survived: summary.objections.survived,
                      noEffect: summary.objections.withoutEffect,
                    })
                  : tq("objections.none")}
              </li>
              <li>{t("summary.weight", { n: summary.weightChangedWinner, total: summary.councils })}</li>
            </ul>
            <p className="mt-3 text-xs text-muted">{tq("footer")}</p>
          </Card>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-4 py-2">{t("col.council")}</th>
                  <th className="px-4 py-2">{tq("participation.title")}</th>
                  <th className="px-4 py-2">{tq("convergence.title")}</th>
                  <th className="px-4 py-2">{tq("objections.title")}</th>
                  <th className="px-4 py-2">{tq("weight.title")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {councils.map((c) => (
                  <tr key={c.sessionId}>
                    <td className="px-4 py-2">
                      <Link href={`/sessions/${c.sessionId}`} className="font-medium hover:underline">
                        {c.projectName}
                      </Link>
                      <span className="block text-xs text-muted">
                        {DECISION_MODE_LABELS[c.mode]} · {format.dateTime(c.createdAt, { dateStyle: "short" })}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {c.quality.participation && c.quality.participation.percent !== null
                        ? `${c.quality.participationGroups?.valid ?? c.quality.participation.valid}/${c.quality.participationGroups?.total ?? c.quality.participation.total}`
                        : "–"}
                    </td>
                    <td className="px-4 py-2">{c.quality.convergence.measurable ? t(`level.${c.quality.convergence.level}`) : "–"}</td>
                    <td className="px-4 py-2">{c.quality.objections.total ? `${c.quality.objections.survived}/${c.quality.objections.total}` : "0"}</td>
                    <td className="px-4 py-2">
                      {!c.quality.weight.measurable ? "–" : c.quality.weight.changedWinner ? t("weightDecided") : pct(c.quality.weight.topGroupShare)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">{t("legend")}</p>
        </>
      )}
    </>
  );
}
