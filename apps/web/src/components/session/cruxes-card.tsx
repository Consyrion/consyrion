"use client";

import { COUNCIL_PHASE_LABELS, type CouncilPhase } from "@consyrium/core/browser";
import { interventionCounts } from "./human-questions";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { useEngineText, useUndefendedReasonText } from "./engine-text";
import { Card } from "../ui/surface";
import { deriveCruxes, matchesFilter, noDocumentedDispute, remainingDisagreements, type Crux, type CruxFilter, type CruxStatus } from "./cruxes";
import { useResponseText, type View } from "./helpers";

const STATUS_TONE: Record<CruxStatus, string> = {
  open: "border-warning/60 text-warning",
  unresolved: "border-warning/60 text-warning",
  accepted: "border-danger/60 text-danger",
  refuted: "border-success/60 text-success",
  resolved: "border-success/60 text-success",
};
/** Disputes shown before "show all" – the ones that decided the verdict or still endanger it come first. */
const CRUX_FOCUS = 3;

const STATUS_ICON: Record<CruxStatus, string> = { open: "?", unresolved: "?", accepted: "!", refuted: "✓", resolved: "✓" };

/** Key disputes (#267) on the Final Verdict screen: at most three, each traceable to stored statements. */
export function CruxesCard({ view, recommendedId }: { view: View; recommendedId: string | null }) {
  const t = useTranslations("verdict.cruxes");
  const [filter, setFilter] = useState<CruxFilter>("all");
  // QA 12.11.26: the chips counted six disputes while only three were listed and nothing said so – the first three stay
  // the focus, the rest is one click away and the count always matches what can be reached.
  const [showAll, setShowAll] = useState(false);
  const everything = deriveCruxes(view, recommendedId, Number.POSITIVE_INFINITY);
  const matching = deriveCruxes(view, recommendedId, Number.POSITIVE_INFINITY, filter);
  const cruxes = showAll ? matching : matching.slice(0, CRUX_FOCUS);
  const remaining = remainingDisagreements(view);
  if (!everything.length && !remaining.length) {
    // Far enough for disputes but none stored: say so instead of disappearing or inventing one (#267).
    if (!noDocumentedDispute(view)) return null;
    return (
      <Card>
        <h3 className="font-semibold">{t("title")}</h3>
        <p className="mt-1 text-sm text-muted">{t("none")}</p>
      </Card>
    );
  }
  const filters: CruxFilter[] = ["all", "open", "critical", "resolved"];
  return (
    <Card id="key-disputes" className="scroll-mt-6">
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted">{t("intro")}</p>
      <HumanCount view={view} />
      {everything.length ? (
        <div role="group" aria-label={t("filterAria")} className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className="rounded-full border border-line px-2.5 py-1 text-muted aria-pressed:border-primary aria-pressed:text-text"
            >
              {t(`filter.${f}`, { n: everything.filter((c) => matchesFilter(c, f)).length })}
            </button>
          ))}
        </div>
      ) : null}
      {everything.length && !cruxes.length ? <p className="mt-3 text-sm text-muted">{t("filterEmpty")}</p> : null}
      <ol className="mt-3 space-y-3">
        {cruxes.map((c, i) => (
          <CruxItem key={c.id} crux={c} index={i + 1} />
        ))}
      </ol>
      {matching.length > CRUX_FOCUS ? (
        <button type="button" className="mt-2 text-xs text-primary underline" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? t("showFewer", { n: CRUX_FOCUS }) : t("showAll", { n: matching.length })}
        </button>
      ) : null}
      {remaining.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium">{t("remaining")}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">
            {remaining.map((d) => (
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
  const reasonText = useUndefendedReasonText();
  const responseText = useResponseText();
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "medium" }) : t("notStored"));
  const s = c.sources;
  // The way of the objection, step by step; a time only where one is stored (answers and reviews have none).
  const steps = [
    { key: "raised", text: t("step.raised"), time: s.raisedAt },
    {
      key: "answer",
      text: c.author.unanswered ? t("step.unanswered") : c.author.conceded ? t("step.conceded") : c.author.response ? t("step.answered") : t("step.noAnswer"),
      time: null,
    },
    { key: "review", text: c.review.reason ? t("step.reviewed") : t("step.notReviewed"), time: null },
    { key: "revision", text: c.revision ? t("step.revised", { version: c.revision.version }) : t("step.notRevised"), time: s.revisedAt },
    { key: "status", text: t(`status.${c.status}`), time: null },
  ];
  return (
    <li className="rounded-xl border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-text">{t("number", { n: index })}</span>
        <span className="text-muted">{t("proposal", { label: c.proposal })}</span>
        <span className="rounded-full border border-line px-2 py-0.5 text-muted">
          {t(`severity.${c.severity}`)}
          {c.category ? ` · ${t.has(`category.${c.category}`) ? t(`category.${c.category}`) : c.category.replaceAll("_", " ")}` : ""}
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
            ? t("unanswered", { reason: reasonText(c.author.unanswered) })
            : c.author.conceded
              ? `${t("conceded")}${c.author.response ? ` – ${responseText(c.author.response)}` : ""}`
              : c.author.response
                ? responseText(c.author.response)
                : t("noAnswer")}
        </dd>
        <dt className="text-muted">{t("review")}</dt>
        <dd>{c.review.reason ? `${c.review.by ? `${c.review.by}: ` : ""}${engine(c.review.reason)}` : t("notReviewed")}</dd>
        <dt className="text-muted">{t("changed")}</dt>
        <dd>
          {c.revision ? (c.revision.moot ? t("revisedMoot", { version: c.revision.version }) : t("revised", { version: c.revision.version })) : t("notRevised")}
        </dd>
      </dl>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-muted" aria-label={t("stepsAria")}>
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-1">
            {i ? <span aria-hidden="true">→</span> : null}
            <span className="rounded-md border border-line px-1.5 py-0.5">
              {step.text}
              {step.time ? (
                <time dateTime={step.time} className="ml-1 font-mono">
                  {format.dateTime(new Date(step.time), { timeStyle: "short" })}
                </time>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-2 text-xs text-primary underline">
        {open ? t("hideSources") : t("showSources")}
      </button>
      {open ? (
        <dl className="mt-2 grid gap-1.5 rounded-lg border border-line p-3 text-xs sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">{t("src.objection")}</dt>
          <dd>
            <code className="font-mono">{s.objectionId}</code> · {when(s.raisedAt)}
          </dd>
          <dt className="text-muted">{t("src.message")}</dt>
          <dd>
            {s.message ? (
              <>
                <code className="font-mono">{s.message.id}</code> · {COUNCIL_PHASE_LABELS[s.message.phase as CouncilPhase] ?? s.message.phase}
                {s.message.round != null ? ` · ${t("src.round", { n: s.message.round })}` : ""} · {when(s.message.createdAt)}
                <span className="mt-1 block whitespace-pre-wrap text-text">{s.message.body}</span>
              </>
            ) : (
              t("notStored")
            )}
          </dd>
          <dt className="text-muted">{t("src.versions")}</dt>
          <dd>
            {s.attackedVersion != null || s.currentVersion != null
              ? t("src.versionsText", {
                  then: s.attackedVersion != null ? `v${s.attackedVersion}` : "–",
                  now: s.currentVersion != null ? `v${s.currentVersion}` : "–",
                })
              : t("notStored")}
          </dd>
          <dt className="text-muted">{t("src.review")}</dt>
          <dd>{c.review.reason ? `${c.review.by ? `${c.review.by}: ` : ""}${engine(c.review.reason)}` : t("notReviewed")}</dd>
        </dl>
      ) : null}
    </li>
  );
}

/** #15/#41 (read-only): how many human questions and marks exist – shown, never counted in the ranking. */
function HumanCount({ view }: { view: View }) {
  const t = useTranslations("interventions");
  const { questions, marks } = interventionCounts(view);
  if (!questions && !marks) return null;
  return <p className="mt-1 text-xs text-primary">{t("cruxCount", { questions, marks })}</p>;
}
