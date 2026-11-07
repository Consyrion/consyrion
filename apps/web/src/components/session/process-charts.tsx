"use client";

import { CRITERIA, type Criterion } from "@consyrion/core/browser";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "../ui/surface";
import type { View } from "./helpers";

/**
 * Stage-2 result charts (owner request 05.11.26): how far the evaluators agree, how the council ran and what it used.
 * Everything is read from stored rows – raw scores per evaluator, stage timestamps, usage – nothing is recomputed into
 * a new verdict. Colours follow the participant (fixed order), never the rank; every dot also carries the model's
 * letter, so identity never depends on colour alone.
 */

const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];

interface ScoreRow {
  revisionId: string;
  evaluatorParticipantId: string;
  criterion: string;
  score: number;
  rationale: string;
  createdAt?: string | Date;
}

export function ProcessCharts({
  view,
  criterionMeans,
}: {
  view: View;
  /** Server means per proposal and criterion (the matrix), drawn as the reference tick. */
  criterionMeans: Record<string, Partial<Record<Criterion, number>>>;
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-5">
      <EvaluatorAgreement view={view} criterionMeans={criterionMeans} />
      <div className="space-y-4 lg:col-span-2">
        <PhaseTimeline view={view} />
        <TokensPerModel view={view} />
      </div>
    </div>
  );
}

/** Participants in a fixed order: the same model keeps the same colour and letter everywhere. */
function series(view: View) {
  return view.participants.map((p, i) => ({
    id: p.id,
    name: p.modelId,
    color: SERIES[i % SERIES.length]!,
    letter: String(i + 1),
  }));
}

function EvaluatorAgreement({ view, criterionMeans }: { view: View; criterionMeans: Record<string, Partial<Record<Criterion, number>>> }) {
  const t = useTranslations("verdict.process");
  const crit = useTranslations("verdict.dashboard.criteria");
  const proposals = view.proposals;
  const [selected, setSelected] = useState(proposals[0]?.id ?? "");
  const people = series(view);
  const proposal = proposals.find((p) => p.id === selected);
  if (!proposal) return null;
  // Scores of the latest evaluated revision of this proposal; the author's own proposal is never scored by the author.
  const revisionIds = new Set(proposal.revisions.map((r) => r.id));
  const rows = ((view.scores ?? []) as ScoreRow[]).filter((s) => revisionIds.has(s.revisionId));
  const latestRevision = [...proposal.revisions].reverse().find((r) => rows.some((s) => s.revisionId === r.id));
  const scores = rows.filter((s) => s.revisionId === latestRevision?.id && s.evaluatorParticipantId !== proposal.authorParticipantId);
  const evaluators = people.filter((p) => scores.some((s) => s.evaluatorParticipantId === p.id));

  return (
    <Card className="lg:col-span-3">
      <h3 className="font-semibold">{t("agreement.title")}</h3>
      <p className="text-xs text-muted">{t("agreement.intro")}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label={t("agreement.choose")}>
        {proposals.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === selected}
            onClick={() => setSelected(p.id)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${p.id === selected ? "border-primary text-text" : "border-line text-muted hover:text-text"}`}
          >
            {t("proposal", { label: p.label ?? "?" })}
          </button>
        ))}
      </div>
      {evaluators.length ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted" aria-label={t("agreement.legend")}>
            {evaluators.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <Dot color={p.color} letter={p.letter} />
                {p.name}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-0.5 bg-text" />
              {t("agreement.mean")}
            </li>
          </ul>
          <div className="mt-3 space-y-3">
            {CRITERIA.map((c) => {
              const mine = scores.filter((s) => s.criterion === c);
              const values = mine.map((s) => s.score);
              const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
              const mean = criterionMeans[proposal.id]?.[c];
              return (
                <div key={c}>
                  <p className="flex justify-between text-xs">
                    <span className="font-medium">{crit(c)}</span>
                    <span className={spread >= 3 ? "text-warning" : "text-muted"}>
                      {spread >= 3 ? "! " : ""}
                      {t("agreement.spread", { n: spread })}
                    </span>
                  </p>
                  {/* 0–10 scale; dots overlapping on equal scores are offset vertically so each stays visible. */}
                  <div className="relative mt-1 h-7 rounded-md bg-surface-2" role="img" aria-label={`${crit(c)}: ${mine.map((s) => `${people.find((p) => p.id === s.evaluatorParticipantId)?.name ?? "?"} ${s.score}`).join(", ")}`}>
                    {[0, 5, 10].map((tick) => (
                      <span key={tick} aria-hidden="true" className="absolute top-0 h-full w-px bg-line" style={{ left: `${tick * 10}%` }} />
                    ))}
                    {typeof mean === "number" ? (
                      <span aria-hidden="true" className="absolute top-1 h-5 w-0.5 -translate-x-1/2 bg-text" style={{ left: `${mean * 10}%` }} />
                    ) : null}
                    {mine.map((s) => {
                      const person = people.find((p) => p.id === s.evaluatorParticipantId);
                      const same = mine.filter((o) => o.score === s.score);
                      const offset = same.length > 1 ? (same.indexOf(s) - (same.length - 1) / 2) * 8 : 0;
                      return (
                        <span
                          key={s.evaluatorParticipantId}
                          className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                          style={{ left: `${s.score * 10}%`, marginTop: offset }}
                          title={`${person?.name ?? "?"}: ${s.score}/10 – ${s.rationale}`}
                        >
                          <Dot color={person?.color ?? "var(--muted)"} letter={person?.letter ?? "?"} />
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 flex justify-between text-[10px] text-muted" aria-hidden="true">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </p>
          <p className="mt-1 text-[11px] text-muted">{t("agreement.note")}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("agreement.none")}</p>
      )}
    </Card>
  );
}

function Dot({ color, letter }: { color: string; letter: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-4 place-items-center rounded-full text-[9px] font-semibold text-white ring-2 ring-surface"
      style={{ backgroundColor: color }}
    >
      {letter}
    </span>
  );
}

const PHASE_ORDER = ["independent_thinking", "open_council", "twelve_minds_council", "minority_review", "consensus_round", "final_verdict", "execution_council"];
const PHASE_NAME: Record<string, string> = {
  independent_thinking: "Independent Thinking",
  open_council: "Open Council",
  twelve_minds_council: "12 Minds Council",
  minority_review: "Minority Review",
  consensus_round: "Consensus Round",
  final_verdict: "Final Verdict",
  execution_council: "Execution Council",
};

/** When each phase ran, on one time axis from the council's start (canonical phase names stay English). */
function PhaseTimeline({ view }: { view: View }) {
  const t = useTranslations("verdict.process");
  const stages = ((view.stages ?? []) as Array<{ phase: string; status: string; startedAt?: string | Date | null; completedAt?: string | Date | null }>)
    .filter((s) => s.startedAt)
    .map((s) => ({
      phase: s.phase,
      status: s.status,
      start: new Date(s.startedAt as string).getTime(),
      end: s.completedAt ? new Date(s.completedAt as string).getTime() : null,
    }))
    .sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
  if (!stages.length) return null;
  const t0 = Math.min(...stages.map((s) => s.start));
  const t1 = Math.max(...stages.map((s) => s.end ?? s.start));
  const span = Math.max(1, t1 - t0);
  return (
    <Card>
      <h3 className="font-semibold">{t("timeline.title")}</h3>
      <p className="text-xs text-muted">{t("timeline.total", { duration: duration(span) })}</p>
      <ul className="mt-3 space-y-2">
        {stages.map((s) => {
          const left = ((s.start - t0) / span) * 100;
          const width = Math.max(1.5, (((s.end ?? s.start) - s.start) / span) * 100);
          return (
            <li key={s.phase} className="text-xs">
              <p className="flex justify-between gap-2">
                <span>{PHASE_NAME[s.phase] ?? s.phase}</span>
                <span className="tabular-nums text-muted">{s.end ? duration(s.end - s.start) : t("timeline.running")}</span>
              </p>
              <div className="relative mt-1 h-2 rounded-full bg-surface-2">
                <span
                  className={`absolute top-0 h-full rounded-full ${s.status === "failed" ? "bg-danger" : "bg-primary/70"}`}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 1) return "< 1 s";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** Tokens per model (input + output) from the usage rows, with failed calls named. */
function TokensPerModel({ view }: { view: View }) {
  const t = useTranslations("verdict.process");
  const format = useFormatter();
  const people = series(view);
  const rows = people
    .map((p) => {
      // Council phases only (ChatGPT test 06.11.26): build calls of the Execution Council are counted in its own tab, so
      // this sum matches "tokens used" in the header (except reservations of calls that failed before answering).
      const mine = (view.usage ?? []).filter((u) => u.participantId === p.id && u.phase !== "execution_council");
      return {
        ...p,
        input: mine.reduce((sum, u) => sum + u.inputTokens, 0),
        output: mine.reduce((sum, u) => sum + u.outputTokens, 0),
        failed: mine.filter((u) => u.outcome !== "ok").reduce((sum, u) => sum + u.calls, 0),
      };
    })
    .filter((r) => r.input + r.output > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.input + r.output));
  return (
    <Card>
      <h3 className="font-semibold">{t("tokens.title")}</h3>
      <p className="text-xs text-muted">{t("tokens.intro")}</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.id} className="text-xs">
            <p className="flex justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Dot color={r.color} letter={r.letter} />
                {r.name}
              </span>
              <span className="tabular-nums">{format.number(r.input + r.output)}</span>
            </p>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-surface-2" title={t("tokens.split", { input: format.number(r.input), output: format.number(r.output) })}>
              <span className="h-full bg-primary/70" style={{ width: `${(r.input / max) * 100}%` }} />
              <span className="ml-0.5 h-full bg-accent/80" style={{ width: `${(r.output / max) * 100}%` }} />
            </div>
            {r.failed ? <p className="mt-0.5 text-warning">! {t("tokens.failed", { n: r.failed })}</p> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 flex gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-primary/70" /> {t("tokens.input")}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-accent/80" /> {t("tokens.output")}
        </span>
      </p>
    </Card>
  );
}

