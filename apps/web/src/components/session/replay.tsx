"use client";

import { COUNCIL_PHASE_LABELS, COUNCIL_PHASES } from "@consyrion/core/browser";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Badge, Card } from "../ui/surface";
import { modelName, proposalLabel, useEnumText, useRoleLabel, type View } from "./helpers";
import { buildReplayEvents, replayEdges, replayState, type ReplayEvent } from "./replay-events";
import { ReplayNetwork } from "./replay-network";

const SPEEDS = { "1": 1500, "2": 750, "4": 375 } as const;
/**
 * Long sessions (hundreds of messages): the timeline renders a window of events ending at the cursor, not every row
 * (#271 part 2). Older entries load in steps of the same size on request; the scrubber still covers all events.
 */
export const REPLAY_PAGE = 150;
type Speed = keyof typeof SPEEDS;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The events the timeline renders: at most `shown` entries, ending at the cursor, with their index in the full list. */
export function windowOf(events: ReplayEvent[], cursor: number, shown: number) {
  const start = Math.max(0, cursor + 1 - shown);
  return events.slice(start, cursor + 1).map((event, i) => ({ event, index: start + i }));
}

/**
 * "Verlauf" tab (#271, part 1): the council as a timeline of stored events, replayable step by step. Read-only – it
 * writes nothing and calls no model; a running session follows the live state from the existing stream.
 */
export function ReplayScreen({ view, live }: { view: View; live: boolean }) {
  const t = useTranslations("replay");
  const format = useFormatter();
  const roleText = useRoleLabel();
  const severityText = useEnumText("verdict.cruxes.severity");
  const objectionStatusText = useEnumText("phaseScreens.objectionStatus");
  const consensusText = useEnumText("phaseScreens.consensus.status");
  const { events, withoutTime } = useMemo(() => buildReplayEvents(view), [view]);
  const last = events.length - 1;
  const [cursor, setCursor] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(REPLAY_PAGE);
  const [layout, setLayout] = useState<"timeline" | "network" | "table">("timeline");
  const followLive = useRef(true);
  const currentRef = useRef<HTMLLIElement>(null);

  // Live: new stored events arrive through the session stream; stay on the newest one unless the user scrubbed back.
  useEffect(() => {
    if (followLive.current) setCursor(last);
    else setCursor((c) => Math.min(c, last));
  }, [last]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setCursor((c) => Math.min(c + 1, last)), SPEEDS[speed]);
    return () => clearTimeout(timer);
  }, [playing, cursor, last, speed]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [cursor]);

  const move = (next: number) => {
    const value = Math.max(0, Math.min(last, next));
    followLive.current = value >= last;
    setCursor(value);
  };

  if (!events.length)
    return (
      <Card>
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("empty")}</p>
      </Card>
    );

  const state = replayState(view, events, cursor);
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const label = (proposalId: string | null) => proposalLabel(view, proposalId);
  const who = (participantId: string | null) => (participantId ? modelName(view, participantId) : null);

  function summary(e: ReplayEvent): string {
    const d = e.data;
    const phase = e.phase ? COUNCIL_PHASE_LABELS[e.phase] : "";
    switch (e.kind) {
      case "stage_started":
        return t("event.stageStarted", { phase });
      case "stage_completed":
        return t(d.status === "failed" ? "event.stageFailed" : "event.stageCompleted", { phase });
      case "revision":
        return t("event.revision", { label: String(d.label ?? "?"), version: Number(d.version ?? 1) });
      case "message": {
        const kind = t.has(`kind.${d.messageKind}`) ? t(`kind.${d.messageKind}`) : String(d.messageKind);
        const head = t("event.message", { model: who(e.participantId) ?? "?", kind });
        return e.proposalId ? `${head} · ${t("event.toProposal", { label: label(e.proposalId) })}` : head;
      }
      case "objection":
        return t("event.objection", { model: who(e.participantId) ?? "?", label: label(e.proposalId) });
      case "minority_review":
        return t("event.minorityReview");
      case "scores":
        return t("event.scores", { model: who(e.participantId) ?? "?", count: Number(d.count ?? 0) });
      case "vote":
        return t("event.vote", { model: who(e.participantId) ?? "?" });
      case "consensus":
        return t("event.consensus", { status: consensusText(String(d.status ?? "")) });
      case "decision":
        return `${t("event.decision", { outcome: t.has(`outcome.${d.outcome}`) ? t(`outcome.${d.outcome}`) : String(d.outcome) })}${d.superseded ? ` (${t("event.superseded")})` : ""}`;
      case "approval":
        return t("event.approval", { action: t.has(`action.${d.action}`) ? t(`action.${d.action}`) : String(d.action) });
    }
  }

  /** The stored text behind an event – shown exactly as written, never shortened into a fake quote. */
  function details(e: ReplayEvent) {
    const d = e.data;
    if (e.kind === "message")
      return (
        <>
          <p className="text-xs text-muted">
            {[
              d.role ? roleText(String(d.role)) : null,
              d.round != null ? t("round", { n: Number(d.round) }) : null,
              d.severity ? severityText(String(d.severity)) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{String(d.body ?? "")}</p>
        </>
      );
    if (e.kind === "objection")
      return (
        <>
          <p className="text-xs text-muted">{[severityText(String(d.severity ?? "")), String(d.category ?? "")].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{String(d.claim ?? "")}</p>
          <p className="mt-1 text-xs text-muted">
            {state.objectionDecisionsFinal ? t("objectionFinal", { status: objectionStatusText(String(d.status ?? "")) }) : t("objectionPending")}
          </p>
        </>
      );
    if (e.kind === "revision" && d.title) return <p className="text-sm">{String(d.title)}</p>;
    if (e.kind === "approval" && d.comment) return <p className="whitespace-pre-wrap text-sm">{String(d.comment)}</p>;
    return null;
  }

  const current = events[cursor]!;
  const mode = live && state.atEnd ? "live" : state.atEnd ? "completed" : "replay";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t("title")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
          </div>
          <Badge tone={mode === "live" ? "primary" : mode === "replay" ? "accent" : "neutral"}>{t(`mode.${mode}`)}</Badge>
        </div>

        {/* Phase states at the cursor – words, not only colours. */}
        <ol className="mt-4 flex flex-wrap gap-2" aria-label={t("phasesAria")}>
          {COUNCIL_PHASES.map((phase) => (
            <li
              key={phase}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                state.phases[phase] === "running"
                  ? "border-primary text-text"
                  : state.phases[phase] === "completed"
                    ? "border-success/40 text-success"
                    : state.phases[phase] === "failed"
                      ? "border-danger/40 text-danger"
                      : "border-line text-muted"
              }`}
            >
              {COUNCIL_PHASE_LABELS[phase]} · {t(`phase.${state.phases[phase]}`)}
            </li>
          ))}
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => move(cursor - 1)} disabled={cursor <= 0} aria-label={t("stepBack")}>
            ‹
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!playing && cursor >= last) move(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? t("pause") : t("play")}
          </Button>
          <Button variant="secondary" onClick={() => move(cursor + 1)} disabled={cursor >= last} aria-label={t("stepForward")}>
            ›
          </Button>
          <Select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} aria-label={t("speed")} size="sm">
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </Select>
          <Button variant="ghost" onClick={() => move(last)} disabled={cursor >= last}>
            {t(live ? "toLive" : "toEnd")}
          </Button>
          <span className="ml-auto text-xs text-muted">{t("position", { n: cursor + 1, total: events.length, time: time(current.at) })}</span>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={cursor}
          onChange={(e) => move(Number(e.target.value))}
          aria-label={t("scrubber")}
          aria-valuetext={summary(current)}
          className="mt-3 w-full accent-[var(--primary)]"
        />
        {withoutTime ? <p className="mt-2 text-xs text-muted">{t("withoutTime", { n: withoutTime })}</p> : null}
        {/* One calm announcement for screen readers – not every playback step. */}
        <p className="sr-only" aria-live="polite">
          {playing ? "" : summary(current)}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <h3 className="font-semibold">{t("participants")}</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {view.participants.map((p) => {
              const failed = state.failedParticipants.includes(p.id);
              const roles = view.roles.filter((r) => r.participantId === p.id).map((r) => roleText(r.role));
              return (
                <li key={p.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{modelName(view, p.id)}</span>
                    <Badge tone={failed ? "danger" : "neutral"}>{failed ? t("failed") : t("active")}</Badge>
                  </div>
                  {roles.length ? <p className="mt-1 text-xs text-muted">{roles.join(", ")}</p> : null}
                  {failed ? <p className="mt-1 text-xs text-muted">{t("failedNote")}</p> : null}
                </li>
              );
            })}
          </ul>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">{t("countMessages")}</dt>
            <dd className="text-right">{state.messages}</dd>
            <dt className="text-muted">{t("countObjections")}</dt>
            <dd className="text-right">{state.objections}</dd>
          </dl>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t(layout === "network" ? "network.title" : layout === "table" ? "table.title" : "timeline")}</h3>
            <div role="group" aria-label={t("layoutAria")} className="flex gap-1 rounded-lg border border-line p-0.5 text-xs">
              {(["timeline", "network", "table"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={layout === value}
                  onClick={() => setLayout(value)}
                  className="rounded-md px-2.5 py-1 text-muted aria-pressed:bg-primary/15 aria-pressed:text-text"
                >
                  {t(`layout.${value}`)}
                </button>
              ))}
            </div>
          </div>
          {layout === "network" ? <ReplayNetwork view={view} edges={replayEdges(events, cursor)} events={events} summary={summary} details={details} /> : null}
          {layout !== "network" && cursor + 1 > shown ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{t("olderHidden", { n: cursor + 1 - shown })}</span>
              <Button variant="ghost" onClick={() => setShown((n) => n + REPLAY_PAGE)}>
                {t("showOlder", { n: Math.min(REPLAY_PAGE, cursor + 1 - shown) })}
              </Button>
            </div>
          ) : null}
          {layout === "table" ? (
            // Table view (#271 part 4): the same stored events as the timeline, one row each, same window.
            <div className="mt-3 max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">{t("table.caption")}</caption>
                <thead className="sticky top-0 bg-surface text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      {t("table.time")}
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      {t("table.phase")}
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      {t("table.event")}
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      {t("table.model")}
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      {t("table.proposal")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {windowOf(events, cursor, shown).map(({ event: e, index }) => (
                    <tr key={e.id} aria-current={index === cursor ? "step" : undefined} className="border-t border-line aria-[current=step]:bg-primary/10">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                        <time dateTime={e.at}>{time(e.at)}</time>
                      </td>
                      <td className="px-2 py-1.5 text-muted">{e.phase ? COUNCIL_PHASE_LABELS[e.phase] : "–"}</td>
                      <td className="px-2 py-1.5">{summary(e)}</td>
                      <td className="px-2 py-1.5 text-muted">{who(e.participantId) ?? "–"}</td>
                      <td className="px-2 py-1.5 text-muted">{e.proposalId ? label(e.proposalId) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ol className={`mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1 ${layout !== "timeline" ? "hidden" : ""}`}>
            {windowOf(events, cursor, shown).map(({ event: e, index }) => {
              const isCurrent = index === cursor;
              const body = details(e);
              return (
                <li key={e.id} ref={isCurrent ? currentRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                    aria-expanded={body ? open === e.id : undefined}
                    disabled={!body}
                    className={`flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-sm disabled:cursor-default ${
                      isCurrent ? "bg-primary/10 text-text" : "text-muted hover:bg-surface-2"
                    }`}
                  >
                    <time dateTime={e.at} className="shrink-0 font-mono text-xs">
                      {time(e.at)}
                    </time>
                    <span className="min-w-0">{summary(e)}</span>
                  </button>
                  {body && open === e.id ? <div className="ml-16 mb-2 rounded-lg border border-line p-3">{body}</div> : null}
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
