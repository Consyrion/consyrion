"use client";

import { useTranslations } from "next-intl";
import { useEngineText } from "./engine-text";
import { Card } from "../ui/surface";
import { deriveCruxes, remainingDisagreements, type Crux, type CruxStatus } from "./cruxes";
import type { View } from "./helpers";

const STATUS_TONE: Record<CruxStatus, string> = {
  open: "border-warning/60 text-warning",
  unresolved: "border-warning/60 text-warning",
  accepted: "border-danger/60 text-danger",
  refuted: "border-success/60 text-success",
  resolved: "border-success/60 text-success",
};
const STATUS_ICON: Record<CruxStatus, string> = { open: "?", unresolved: "?", accepted: "!", refuted: "✓", resolved: "✓" };

/** Key disputes (#267) on the Final Verdict screen: at most three, each traceable to stored statements. */
export function CruxesCard({ view, recommendedId }: { view: View; recommendedId: string | null }) {
  const t = useTranslations("verdict.cruxes");
  const cruxes = deriveCruxes(view, recommendedId);
  const remaining = remainingDisagreements(view);
  if (!cruxes.length && !remaining.length) return null;
  return (
    <Card>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted">{t("intro")}</p>
      <ol className="mt-3 space-y-3">
        {cruxes.map((c, i) => (
          <CruxItem key={c.id} crux={c} index={i + 1} />
        ))}
      </ol>
      {remaining.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium">{t("remaining")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">
            {remaining.slice(0, 5).map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-muted">{t("source")}</p>
    </Card>
  );
}

function CruxItem({ crux: c, index }: { crux: Crux; index: number }) {
  const t = useTranslations("verdict.cruxes");
  const engine = useEngineText();
  return (
    <li className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-text">{t("number", { n: index })}</span>
        <span className="text-muted">{t("proposal", { label: c.proposal })}</span>
        <span className="rounded-full border border-line px-2 py-0.5 text-muted">
          {t(`severity.${c.severity}`)}
          {c.category ? ` · ${c.category.replaceAll("_", " ")}` : ""}
        </span>
        <span className={`rounded-full border px-2 py-0.5 ${STATUS_TONE[c.status]}`}>
          <span aria-hidden="true">{STATUS_ICON[c.status]}</span> {t(`status.${c.status}`)}
        </span>
        {c.blocking ? <span className="rounded-full border border-danger/60 px-2 py-0.5 text-danger">{t("blocking")}</span> : null}
        {c.recommended ? <span className="text-primary">{t("recommended")}</span> : null}
      </div>
      <p className="mt-2 font-medium">“{c.claim.text}”</p>
      <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted">{t("raisedBy")}</dt>
        <dd>
          {c.claim.by}
          {c.claim.role ? ` · ${c.claim.role}` : ""}
          {c.claim.evidence ? (
            <span className="block text-muted">
              {t("evidence")}: {c.claim.evidence}
            </span>
          ) : null}
        </dd>
        <dt className="text-muted">{t("authorAnswer", { model: c.author.by })}</dt>
        <dd>
          {c.author.unanswered
            ? t("unanswered", { reason: c.author.unanswered })
            : c.author.conceded
              ? `${t("conceded")}${c.author.response ? ` – ${c.author.response}` : ""}`
              : (c.author.response ?? t("noAnswer"))}
        </dd>
        <dt className="text-muted">{t("review")}</dt>
        <dd>{c.review.reason ? `${c.review.by ? `${c.review.by}: ` : ""}${engine(c.review.reason)}` : t("notReviewed")}</dd>
        <dt className="text-muted">{t("changed")}</dt>
        <dd>
          {c.revision ? (c.revision.moot ? t("revisedMoot", { version: c.revision.version }) : t("revised", { version: c.revision.version })) : t("notRevised")}
        </dd>
      </dl>
    </li>
  );
}
