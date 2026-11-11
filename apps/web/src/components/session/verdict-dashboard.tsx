"use client";

import { CRITERIA, type Criterion } from "@consyrium/core/browser";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "../ui/surface";
import { CruxesCard } from "./cruxes-card";
import { modelName, proposalLabel, type View } from "./helpers";
import type { IdeaCheckResult } from "./idea-check";
import { filterRequirementRows, REQUIREMENT_CELL, requirementCellKey } from "./requirement-status";
import { useFeasibilityLabel, type RequirementGateResult } from "./requirement-gate";

/**
 * Verdict dashboard (owner request 05.11.26, stage 1 of the result visualisations): the decision at a glance for a
 * non-technical reader, every number traceable for a technical one. It only shows what the server computed – no
 * score is recomputed here. Rules: a failed or unconfirmed requirement outranks any score (blocked proposals are
 * hatched and named as such), colour is never the only signal (icon + word), scores show one decimal (no false
 * precision), and a table view carries the same numbers for screen readers and print.
 */

export const CRITERION_LABELS: Record<Criterion, string> = {
  technicalQuality: "Technical quality",
  security: "Security",
  maintainability: "Maintainability",
  operatingCost: "Operating cost",
  implementationSpeed: "Implementation speed",
};

export interface DashboardMatrixProposal {
  proposalId: string;
  total: number | null;
  criterionMeans: Partial<Record<Criterion, number>>;
  independentEvaluators: number;
  eligible: boolean;
}

export interface DashboardMatrix {
  proposals: DashboardMatrixProposal[];
  weights?: Partial<Record<Criterion, number>>;
  requirementGate?: RequirementGateResult;
}

type Tone = "success" | "warning" | "danger" | "primary" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/60 bg-success/10 text-success",
  warning: "border-warning/60 bg-warning/10 text-warning",
  danger: "border-danger/60 bg-danger/10 text-danger",
  primary: "border-primary/60 bg-primary/10 text-primary",
  neutral: "border-line bg-surface-2 text-muted",
};
const TONE_ICON: Record<Tone, string> = { success: "✓", warning: "!", danger: "✕", primary: "●", neutral: "–" };

/** One decimal: 8.51 and 8.54 are not meaningfully different, so the dashboard never pretends they are. */
export const score1 = (x: number | null | undefined) => (x === null || x === undefined ? "–" : (Math.round(x * 10) / 10).toFixed(1));

/** From this many requirements the heatmap offers a search and a problems-only filter (#266). */
const HEATMAP_FILTER_FROM = 20;

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * Fill per state (design review 05.11.26 with ChatGPT: hatching dominated the results). A blocked proposal stays a calm
 * neutral grey with a lock and the word – it never reads as a contender; only the recommendation carries the accent.
 */
/** Gate status chip beside a score bar (#266): the words come from `requirementGate.feasibility`. */
const GATE_TONE_CLASS: Record<"success" | "warning" | "danger", string> = {
  success: "border-success/50 text-success",
  warning: "border-warning/50 text-warning",
  danger: "border-danger/50 text-danger",
};

const barFill = (blocked: boolean, recommended: boolean) => (blocked ? "bg-muted/35" : recommended ? "bg-primary" : "bg-primary/45");

/** Which verdict the hero names; the screen decides it, the dashboard only words it (#266). */
export type OutcomeKey =
  | "recommended"
  | "tie"
  | "no_qualifying_solution"
  | "insufficient_evidence"
  | "needs_verification"
  | "provisional"
  | "architecture_candidate"
  | "conflict"
  | "not_approvable";

/** The one next step the decision form will offer first (#266) – the dashboard links to it, it never acts itself. */
export type NextAction =
  | "approve"
  | "select_alternative"
  | "repeat_evaluation"
  | "request_changes"
  | "reject"
  | "request_more_debate"
  | "mark_favorite"
  | "approve_prototype"
  | "approve_after_measurement"
  /** Not a decision but the measurement panel (#249 gate 2): the link goes there. */
  | "record_measurement";

export function VerdictDashboard({
  view,
  matrix,
  outcome,
  outcomeKey,
  reason,
  approvableIds,
  recommendedId,
  nextAction,
  idea,
}: {
  view: View;
  matrix: DashboardMatrix & { failedEvaluators?: { participantId: string; modelId: string; outcome: string }[] };
  outcome: { title: string; tone: "success" | "warning" | "danger" | "neutral" };
  outcomeKey?: OutcomeKey;
  /** One sentence why – the server's reason or the main cause. */
  reason: string | null;
  approvableIds: ReadonlySet<string>;
  recommendedId: string | null;
  /** Set while the owner can still decide; the button scrolls to the decision form with this action preselected. */
  nextAction?: NextAction | null;
  /**
   * #597: set for a council started as an idea check whose verdict nothing can be approved in – the hero then reads the
   * result as a favourite with open points instead of "not approvable". Read from the stored matrix, never a new status.
   */
  idea?: IdeaCheckResult | null;
}) {
  const t = useTranslations("verdict.dashboard");
  const [asTable, setAsTable] = useState(false);
  const [cell, setCell] = useState<{ requirementId: string; proposalId: string } | null>(null);
  // #266: from 20 requirements on, the heatmap gets a search and a "problems only" filter (rows with any status but met).
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const label = (id: string) => proposalLabel(view, id);
  const feasibility = useFeasibilityLabel();
  const gateStatus = (proposalId: string) => {
    const g = matrix.requirementGate?.proposals.find((x) => x.proposalId === proposalId);
    return g ? feasibility(g) : null;
  };
  const rows = [...matrix.proposals].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const blocked = (id: string) => !approvableIds.has(id);
  const gate = matrix.requirementGate;
  const requirementOrder = (view.requirementList?.items ?? []).map((item, index) => ({ id: item.id, short: `R${index + 1}`, text: item.text }));
  const decision = view.approvals.at(-1);
  const criterion = (c: Criterion) => t(`criteria.${c}`);
  const aiTitle = outcomeKey ? t(`outcome.${outcomeKey}`) : outcome.title;
  // Once a human has decided, the hero states that decision (ChatGPT test 06.11.26: an approved session still read
  // "Tie – please choose"); the AI verdict stays visible as the line below.
  const chosen =
    decision && (decision.action === "approve" || decision.action === "select_alternative") ? (decision.selectedProposalId ?? recommendedId) : null;
  const decided =
    decision && ["approve", "select_alternative", "reject"].includes(decision.action)
      ? decision.action === "reject"
        ? { title: t("decided.rejected"), tone: "neutral" as const }
        : { title: chosen ? t("decided.chosen", { label: label(chosen) }) : t("decided.approved"), tone: "success" as const }
      : null;
  const ideaShown = !decided && idea ? idea : null;
  const title = decided?.title ?? (ideaShown ? t(`idea.title.${ideaShown.kind}`) : aiTitle);
  const heroTone = decided?.tone ?? (ideaShown ? (ideaShown.kind === "none" ? "danger" : "success") : outcome.tone);
  const expectedEvaluators = Math.max(0, view.participants.length - 1);
  // Requirements that no proposal meets (night test 07.11.26: "all copies stay in CH" vs. "nightly copy in the USA"):
  // named in the hero so the owner sees which ones to change; only when nothing can be approved.
  const unmetByAll =
    !approvableIds.size && gate?.proposals.length
      ? requirementOrder.filter((r) => gate.proposals.every((g) => g.requirements.find((x) => x.requirementId === r.id)?.status === "FAIL")).map((r) => r.short)
      : [];
  // R2-02 (night test 08.11.26): needs verification because every proposal leaves the same requirement unconfirmed –
  // named so the owner knows what the brief has to state or the proposals have to show.
  const openByAll =
    !approvableIds.size && gate?.proposals.length
      ? requirementOrder
          .filter((r) => !unmetByAll.includes(r.short))
          .filter((r) =>
            gate.proposals.every((g) => ["UNKNOWN", "DISPUTED", "FAIL"].includes(g.requirements.find((x) => x.requirementId === r.id)?.status ?? "")),
          )
          .filter((r) => gate.proposals.some((g) => g.requirements.find((x) => x.requirementId === r.id)?.status !== "FAIL"))
          .map((r) => r.short)
      : [];

  // Who actually took part per proposal (#266): the author, and the evaluators the gate counted – never roles or personas.
  const participation = (proposalId: string) => {
    const author = view.proposals.find((p) => p.id === proposalId)?.authorParticipantId ?? null;
    const g = gate?.proposals.find((x) => x.proposalId === proposalId);
    const answered = new Set(g ? g.requirements.flatMap((r) => [...r.pass, ...r.fail, ...r.unknown]) : []);
    return { author, evaluators: [...answered] };
  };

  // Facts block (#266, right column): review breadth, open requirements, critical objections, model failures.
  const minBreadth = rows.length ? Math.min(...rows.map((r) => r.independentEvaluators)) : 0;
  const openCells = (gate?.proposals ?? []).flatMap((g) => g.requirements.filter((r) => r.status !== "PASS")).length;
  const criticalOpen = view.objections.filter(
    (o) => (o.severity === "critical" || o.severity === "high") && ["open", "accepted", "unresolved"].includes(o.status) && !o.moot,
  ).length;
  const failed = matrix.failedEvaluators ?? [];

  const visibleRequirements = filterRequirementRows(requirementOrder, gate, { query, onlyProblems });
  return (
    <section aria-label={t("aria")} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1. Status: what CONSYRIUM recommends, or why it does not – and the one next step. */}
        <div className={`rounded-2xl border p-5 lg:col-span-2 ${TONE_CLASS[heroTone]}`}>
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">{t("verdict")}</p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold text-text">
            <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full border text-lg ${TONE_CLASS[heroTone]}`}>
              {TONE_ICON[heroTone]}
            </span>
            {title}
            {!decided && recommendedId ? <span className="text-muted">{t("proposal", { label: label(recommendedId) })}</span> : null}
            {ideaShown?.kind === "favorite" ? <span className="text-muted">{t("proposal", { label: label(ideaShown.leaders[0]!) })}</span> : null}
          </p>
          {ideaShown ? (
            <div className="mt-2 max-w-3xl space-y-2 text-sm text-text" data-testid="idea-check">
              <p>{t(`idea.lead.${ideaShown.kind}`, { list: ideaShown.leaders.map(label).join(", ") })}</p>
              {ideaShown.toClarify.length ? (
                <div>
                  <p className="font-medium">{t("idea.clarify")}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {ideaShown.toClarify.map((id) => {
                      const r = requirementOrder.find((x) => x.id === id);
                      return <li key={id}>{r ? `${r.short} – ${r.text}` : id}</li>;
                    })}
                  </ul>
                </div>
              ) : null}
              {ideaShown.excluded.length ? (
                <div>
                  <p className="font-medium">{t("idea.excluded")}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {ideaShown.excluded.map((e) => (
                      <li key={e.proposalId}>
                        {t("idea.excludedItem", {
                          label: label(e.proposalId),
                          list: e.requirementIds.map((id) => requirementOrder.find((x) => x.id === id)?.short ?? id).join(", "),
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted">{t("idea.note")}</p>
            </div>
          ) : null}
          {decided ? <p className="mt-1 text-xs text-muted">{t("decided.aiVerdict", { verdict: aiTitle })}</p> : null}
          {ideaShown ? null : (
            <p className="mt-1 text-xs font-medium text-text">{approvableIds.size ? t("approvableYes", { n: approvableIds.size }) : t("approvableNo")}</p>
          )}
          {reason && !ideaShown ? <p className="mt-2 max-w-3xl text-sm text-text">{reason}</p> : null}
          {/* #597: who has to act – the lock is a rule of the app, not a decision someone still has to make. */}
          {!decided && !ideaShown && !approvableIds.size ? (
            <p className="mt-2 max-w-3xl text-sm text-text" data-testid="who-acts">
              {t("whoActs")}
            </p>
          ) : null}
          {unmetByAll.length ? (
            <p className="mt-2 max-w-3xl text-sm font-medium text-text">{t("unmetByAll", { list: unmetByAll.join(", "), n: unmetByAll.length })}</p>
          ) : null}
          {openByAll.length ? (
            <p className="mt-2 max-w-3xl text-sm font-medium text-text">{t("openByAll", { list: openByAll.join(", "), n: openByAll.length })}</p>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            {decision
              ? `${t("yourDecision", {
                  action: t.has(`decided.${decision.action}`)
                    ? t(`decided.${decision.action}`)
                    : t.has(`action.${decision.action}`)
                      ? t(`action.${decision.action}`)
                      : decision.action.replaceAll("_", " "),
                })}${decision.comment ? ` – “${decision.comment}”` : ""}`
              : t("nothingBuilt")}
          </p>
          {nextAction ? (
            <a
              href={nextAction === "record_measurement" ? "#measurements" : "#your-decision"}
              data-next-action={nextAction}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text hover:border-primary"
            >
              <span aria-hidden="true">→</span> {t("nextStep")}: {t(`action.${nextAction}`)}
            </a>
          ) : null}
        </div>

        <Card>
          <h3 className="text-sm font-semibold">{t("facts.title")}</h3>
          <dl className="mt-2 space-y-1.5 text-xs">
            <Fact
              label={t("facts.breadth")}
              value={t("facts.breadthValue", { n: minBreadth, of: expectedEvaluators })}
              warn={minBreadth < Math.min(2, expectedEvaluators)}
            />
            {gate ? <Fact label={t("facts.openRequirements")} value={String(openCells)} warn={openCells > 0} /> : null}
            <Fact label={t("facts.criticalObjections")} value={String(criticalOpen)} warn={criticalOpen > 0} />
            <Fact label={t("facts.modelErrors")} value={failed.length ? failed.map((f) => f.modelId).join(", ") : "0"} warn={failed.length > 0} />
          </dl>
          <p className="mt-2 text-[11px] text-muted">{t("facts.note")}</p>
        </Card>
      </div>

      {/* 2. Requirements × proposals – gate before score (#266): shown before any score so no number can hide a FAIL or an
          open check. A cell opens the stored evaluator reasons. */}
      {gate && requirementOrder.length ? (
        <Card>
          <h3 className="font-semibold">{t("requirements.title")}</h3>
          <p className="text-xs text-muted">{t("requirements.intro")}</p>
          {requirementOrder.length >= HEATMAP_FILTER_FROM ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs" data-testid="heatmap-filter">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("requirements.search")}
                aria-label={t("requirements.search")}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1"
              />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                {t("requirements.onlyProblems")}
              </label>
              <span className="text-muted">{t("requirements.shown", { n: visibleRequirements.length, of: requirementOrder.length })}</span>
            </div>
          ) : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th className="text-left font-medium text-muted">{t("requirements.requirement")}</th>
                  {gate.proposals.map((g) => (
                    <th key={g.proposalId} className="w-24 text-center font-medium">
                      {label(g.proposalId)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRequirements.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="max-w-[22rem] text-left font-normal" title={r.text}>
                      <span className="font-medium">{r.short}</span>{" "}
                      <span className="text-muted">{r.text.length > 70 ? `${r.text.slice(0, 69)}…` : r.text}</span>
                    </th>
                    {gate.proposals.map((g) => {
                      const req = g.requirements.find((x) => x.requirementId === r.id);
                      // One derivation for the cell, its detail panel and the Evaluation tab (#266).
                      const key = requirementCellKey(req);
                      const st = REQUIREMENT_CELL[key];
                      const who = req
                        ? [
                            ...req.pass.map((id) => `${modelName(view, id)}: ${t("req.PASS")}`),
                            ...req.fail.map((id) => `${modelName(view, id)}: ${t("req.FAIL")}`),
                            ...req.unknown.map((id) => `${modelName(view, id)}: ${t("req.UNKNOWN")}`),
                            ...req.open.map((id) => `${modelName(view, id)}: ${t("req.noAnswer")}`),
                          ].join("\n")
                        : t("req.noEvaluation");
                      const stated = req ? req.pass.length + req.fail.length + req.unknown.length : 0;
                      const expected = req ? stated + req.open.length : 0;
                      const selected = cell?.requirementId === r.id && cell.proposalId === g.proposalId;
                      return (
                        <td key={g.proposalId} className="p-0">
                          <button
                            type="button"
                            title={who}
                            aria-pressed={selected}
                            onClick={() => setCell(selected ? null : { requirementId: r.id, proposalId: g.proposalId })}
                            className={`w-full rounded-md border px-2 py-1.5 text-center ${st.className} ${selected ? "ring-2 ring-primary" : ""}`}
                          >
                            <span aria-hidden="true">{st.icon}</span> {t(`req.${key}`)}
                            {req && expected ? (
                              <span className="block text-[10px] opacity-80">
                                {key === "DISPUTED"
                                  ? t("req.disputedCount", { pass: req.pass.length, fail: req.fail.length })
                                  : t("req.count", { n: req.pass.length, of: expected })}
                              </span>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* #266: word and symbol carry the meaning; the legend names every state shown. */}
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted" aria-label={t("requirements.legend")} data-testid="heatmap-legend">
            {(["PASS", "FAIL", "DISPUTED", "UNKNOWN", "PLAN", "MEASURE"] as const).map((k) => (
              <li key={k}>
                <span aria-hidden="true">{REQUIREMENT_CELL[k].icon}</span> {t(`req.${k}`)}
              </li>
            ))}
          </ul>
          {cell ? <CellDetail view={view} gate={gate} cell={cell} requirements={requirementOrder} onClose={() => setCell(null)} /> : null}
        </Card>
      ) : null}

      <div className="flex justify-end">
        <button type="button" className="text-xs text-muted underline hover:text-text" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? t("showCharts") : t("showTable")}
        </button>
      </div>

      {asTable ? (
        <ScoreTable view={view} rows={rows} matrix={matrix} blocked={blocked} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          {/* 3. Total scores: one bar per proposal; blocked proposals neutral grey with lock + word, participation beside it. */}
          <Card className="lg:col-span-2">
            <h3 className="font-semibold">{t("overall.title")}</h3>
            <p className="text-xs text-muted">{t("overall.intro")}</p>
            <ul className="mt-4 space-y-4">
              {rows.map((p) => {
                const isBlocked = blocked(p.proposalId);
                const isRecommended = p.proposalId === recommendedId;
                const width = `${Math.max(0, Math.min(10, p.total ?? 0)) * 10}%`;
                const part = participation(p.proposalId);
                return (
                  <li key={p.proposalId} className="group relative">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">
                        {t("proposal", { label: label(p.proposalId) })}
                        {isRecommended ? <span className="ml-2 text-xs text-success">✓ {t("recommended")}</span> : null}
                        {isBlocked ? (
                          <span className="ml-2 text-xs text-muted">
                            <LockIcon /> {t("notApprovable")}
                          </span>
                        ) : null}
                        {/* #266: the gate status beside the score, so a high score never reads as "passed". */}
                        {gateStatus(p.proposalId) ? (
                          <span
                            className={`ml-2 rounded-full border px-1.5 py-px text-[11px] ${GATE_TONE_CLASS[gateStatus(p.proposalId)!.tone]}`}
                            data-testid="gate-status"
                          >
                            {gateStatus(p.proposalId)!.text}
                          </span>
                        ) : null}
                      </span>
                      <span className={`tabular-nums ${isBlocked ? "text-muted" : "font-semibold text-text"}`}>{score1(p.total)}</span>
                    </div>
                    <div
                      className="mt-1.5 h-2.5 rounded-full bg-surface-2"
                      role="img"
                      aria-label={t("barAria", { label: label(p.proposalId), score: score1(p.total), blocked: isBlocked ? "yes" : "no" })}
                    >
                      <div className={`h-full rounded-full transition-[width] ${barFill(isBlocked, isRecommended)}`} style={{ width }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted" data-testid="participation">
                      {part.author ? t("by", { model: shortModel(view, part.author) }) : null}
                      {part.evaluators.length
                        ? ` · ${t("evaluatedBy", { models: part.evaluators.map((id) => shortModel(view, id)).join(", ") })}`
                        : ` · ${t("evaluations", { n: p.independentEvaluators })}`}
                    </p>
                  </li>
                );
              })}
            </ul>
            {rows.length > 1 && rows.every((p) => blocked(p.proposalId)) ? (
              <p className="mt-3 text-xs text-muted">
                <LockIcon /> {t("allBlocked", { n: rows.length })}
              </p>
            ) : null}
          </Card>

          {/* 4. Criteria: one compact matrix (criteria × proposals) with readable numbers instead of 15 thin bars. */}
          <Card className="lg:col-span-3">
            <h3 className="font-semibold">{t("criteriaCard.title")}</h3>
            <p className="text-xs text-muted">{t("criteriaCard.intro")}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="text-left font-medium">{t("criteriaCard.criterion")}</th>
                    {rows.map((p) => (
                      <th key={p.proposalId} className="w-16 text-center font-medium">
                        {blocked(p.proposalId) ? (
                          <>
                            <LockIcon />
                            <span className="sr-only">{t("notApprovable")}</span>
                          </>
                        ) : null}{" "}
                        {label(p.proposalId)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CRITERIA.map((c) => {
                    const values = rows.map((p) => p.criterionMeans[c]).filter((v): v is number => typeof v === "number");
                    const best = values.length ? Math.max(...values) : null;
                    return (
                      <tr key={c}>
                        <th scope="row" className="pr-2 text-left font-normal">
                          <span className="block text-sm">{criterion(c)}</span>
                          {matrix.weights?.[c] !== undefined ? (
                            <span className="block text-[11px] text-muted">{t("weight", { w: matrix.weights[c] })}</span>
                          ) : null}
                        </th>
                        {rows.map((p) => {
                          const v = p.criterionMeans[c];
                          const isBest = best !== null && v === best && values.length > 1;
                          const isBlocked = blocked(p.proposalId);
                          return (
                            <td
                              key={p.proposalId}
                              className={`rounded-lg px-2 py-1.5 text-center tabular-nums ${
                                isBest && !isBlocked ? "bg-primary/15 font-semibold text-text" : "bg-surface-2"
                              } ${isBlocked ? "text-muted" : ""}`}
                              title={`${t("proposal", { label: label(p.proposalId) })} – ${criterion(c)}: ${score1(v)}${isBest ? ` (${t("criteriaCard.best")})` : ""}`}
                            >
                              {score1(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted">{t("criteriaCard.legend")}</p>
          </Card>
        </div>
      )}

      {/* 5. Key disputes (#267): what the models actually disagreed about, from stored events. */}
      <CruxesCard view={view} recommendedId={recommendedId} />

      {/* 6. Objections: how much substantiated criticism each proposal still carries. */}
      <ObjectionSummary view={view} rows={rows.map((r) => r.proposalId)} />
    </section>
  );
}

/** Provider and model in short – "Claude haiku-5-5" reads faster than the full id beside a bar. */
function shortModel(view: View, participantId: string) {
  const p = view.participants.find((x) => x.id === participantId);
  return p ? p.modelId : "?";
}

/** Small lock glyph for "not approvable"; always paired with the word, never alone. */
function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="inline-block size-3 -translate-y-px fill-current">
      <path d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-medium tabular-nums ${warn ? "text-warning" : "text-text"}`}>
        {warn ? <span aria-hidden="true">! </span> : null}
        {value}
      </dd>
    </div>
  );
}

/** The stored checks behind one cell (#266): requirement, every evaluator's status and reason, also checks that did not count. */
function CellDetail({
  view,
  gate,
  cell,
  requirements,
  onClose,
}: {
  view: View;
  gate: RequirementGateResult;
  cell: { requirementId: string; proposalId: string };
  requirements: { id: string; short: string; text: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("verdict.dashboard");
  const r = requirements.find((x) => x.id === cell.requirementId);
  const req = gate.proposals.find((g) => g.proposalId === cell.proposalId)?.requirements.find((x) => x.requirementId === cell.requirementId);
  const checks = (
    (view.requirementChecks ?? []) as Array<{
      id: string;
      proposalId: string;
      requirementId: string;
      evaluatorParticipantId: string;
      status: string;
      evidence?: string | null;
      valid?: boolean;
      invalidReason?: string | null;
    }>
  ).filter((c) => c.proposalId === cell.proposalId && c.requirementId === cell.requirementId);
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-xs" role="region" aria-label={t("cell.aria")} data-testid="cell-detail">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {r?.short} · {t("proposal", { label: proposalLabel(view, cell.proposalId) })} · {t(`req.${requirementCellKey(req)}`)}
        </p>
        <button type="button" className="text-muted underline" onClick={onClose}>
          {t("cell.close")}
        </button>
      </div>
      <p className="mt-1 text-muted">{r?.text}</p>
      {checks.length ? (
        <ul className="mt-2 space-y-1.5">
          {checks.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{modelName(view, c.evaluatorParticipantId)}</span> – {t.has(`req.${c.status}`) ? t(`req.${c.status}`) : c.status}
              {c.evidence ? `: ${c.evidence}` : ""}
              {c.valid === false ? <span className="text-warning"> ({t("cell.notCounted", { reason: c.invalidReason ?? "" })})</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">{t("cell.noChecks")}</p>
      )}
      {req?.open.length ? <p className="mt-1 text-warning">{t("cell.open", { models: req.open.map((id) => modelName(view, id)).join(", ") })}</p> : null}
      <p className="mt-2 text-[11px] text-muted">{t("cell.note")}</p>
    </div>
  );
}

function ObjectionSummary({ view, rows }: { view: View; rows: string[] }) {
  const t = useTranslations("verdict.dashboard");
  const sev = useTranslations("verdict.cruxes.severity");
  const relevant = view.objections.filter((o) => (o.status === "accepted" || o.status === "unresolved" || o.status === "open") && !o.moot);
  if (!view.objections.length) return null;
  const top = relevant
    .filter((o) => o.severity === "critical" || o.severity === "high")
    .sort((a, b) => SEVERITIES.indexOf(a.severity as (typeof SEVERITIES)[number]) - SEVERITIES.indexOf(b.severity as (typeof SEVERITIES)[number]))
    .slice(0, 3);
  const sevWord = (s: string) => (sev.has(s) ? sev(s) : s);
  return (
    <Card>
      <h3 className="font-semibold">{t("objections.title")}</h3>
      <p className="text-xs text-muted">{t("objections.intro")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((id) => {
          const mine = relevant.filter((o) => o.proposalId === id);
          return (
            <div key={id} className="rounded-lg border border-line p-3 text-xs">
              <p className="font-medium">{t("proposal", { label: proposalLabel(view, id) })}</p>
              {mine.length === 0 ? (
                <p className="mt-1 text-success">✓ {t("objections.none")}</p>
              ) : (
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {SEVERITIES.map((s) => {
                    const n = mine.filter((o) => o.severity === s).length;
                    if (!n) return null;
                    const tone = s === "critical" || s === "high" ? "text-danger border-danger/50" : "text-warning border-warning/50";
                    return (
                      <span key={s} className={`rounded-full border px-2 py-0.5 ${tone}`}>
                        {n} {sevWord(s)}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {top.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {top.map((o) => (
            <li key={o.id} className="text-muted">
              <span className="font-medium text-danger">{sevWord(o.severity)}</span> · {t("proposal", { label: proposalLabel(view, o.proposalId) })}: {o.claim}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function ScoreTable({
  view,
  rows,
  matrix,
  blocked,
}: {
  view: View;
  rows: DashboardMatrixProposal[];
  matrix: DashboardMatrix;
  blocked: (id: string) => boolean;
}) {
  const t = useTranslations("verdict.dashboard");
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="mb-2 text-left text-xs text-muted">{t("table.caption")}</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1">{t("table.proposal")}</th>
              <th>{t("table.overall")}</th>
              {CRITERIA.map((c) => (
                <th key={c}>
                  {t(`criteria.${c}`)}
                  {matrix.weights?.[c] !== undefined ? ` (${matrix.weights[c]} %)` : ""}
                </th>
              ))}
              <th>{t("table.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.proposalId}>
                <td className="py-1.5 font-medium">{proposalLabel(view, p.proposalId)}</td>
                <td className="tabular-nums">{score1(p.total)}</td>
                {CRITERIA.map((c) => (
                  <td key={c} className="tabular-nums">
                    {score1(p.criterionMeans[c])}
                  </td>
                ))}
                <td>{blocked(p.proposalId) ? t("notApprovable") : t("approvable")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
