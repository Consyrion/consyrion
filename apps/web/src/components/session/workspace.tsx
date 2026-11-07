"use client";

import { COUNCIL_PHASE_LABELS, DECISION_MODE_LABELS, type CouncilPhase } from "@consyrion/core/browser";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import { Button } from "../ui/button";
import { Alert, Badge } from "../ui/surface";
import { CouncilRoom } from "./council-room";
import type { View } from "./helpers";
import {
  EvaluationScreen,
  ExecutionScreen,
  IndependentThinkingScreen,
  MinorityConsensusScreen,
  OpenCouncilScreen,
  ReviewTestsScreen,
  TwelveMindsScreen,
  VerdictScreen,
} from "./screens";
import { useExecution } from "./execution";
import { executionStates } from "./execution-status";

type Tab = CouncilPhase | "overview" | "evaluation" | "review_tests";

const TABS: Array<{ id: Tab; label: string; phase: CouncilPhase | null }> = [
  { id: "overview", label: "Council room", phase: null },
  { id: "independent_thinking", label: COUNCIL_PHASE_LABELS.independent_thinking, phase: "independent_thinking" },
  { id: "open_council", label: COUNCIL_PHASE_LABELS.open_council, phase: "open_council" },
  { id: "twelve_minds_council", label: COUNCIL_PHASE_LABELS.twelve_minds_council, phase: "twelve_minds_council" },
  { id: "minority_review", label: `${COUNCIL_PHASE_LABELS.minority_review} & ${COUNCIL_PHASE_LABELS.consensus_round}`, phase: "consensus_round" },
  { id: "evaluation", label: "Evaluation", phase: "final_verdict" },
  { id: "final_verdict", label: COUNCIL_PHASE_LABELS.final_verdict, phase: "final_verdict" },
  { id: "execution_council", label: COUNCIL_PHASE_LABELS.execution_council, phase: "execution_council" },
  { id: "review_tests", label: "Review & Tests", phase: "execution_council" },
];

// Words: `sessionWorkspace.status.<status>`; unknown statuses show the raw value.
const STATUS_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "danger" | "accent"> = {
  queued: "neutral",
  running: "primary",
  cancel_requested: "warning",
  cancelled: "neutral",
  failed: "danger",
  awaiting_approval: "accent",
  approved: "success",
  rejected: "neutral",
  changes_requested: "warning",
};

/** Message keys for the fixed English words of executionStates() (execution-status.ts), shown on the build tabs. */
const EXEC_TEXT_KEY: Record<string, string> = {
  "not started": "notStarted",
  "code generated, draft PR opened": "codeGeneratedPr",
  "code generated": "codeGenerated",
  "plan awaiting approval": "planAwaiting",
  running: "running",
  pending: "pending",
  failed: "failed",
  cancelled: "cancelled",
  "reviewed, tests not run": "reviewedNotRun",
  "tests passed, reviewed": "passedReviewed",
  "tests passed": "passed",
  "tests not run": "notRun",
  "tests timed out": "timedOut",
  "tests failed": "testsFailed",
};

const LIVE = new Set(["queued", "running", "cancel_requested"]);

/**
 * Home of a session: the Council Room while it runs; once a verdict exists the Final Verdict (owner decision
 * 05.11.26: "what was decided?" first). The phase tabs hold the detailed screens.
 */
function defaultTab(view: View): Tab {
  return view.decision && !LIVE.has(view.session.status) ? "final_verdict" : "overview";
}

/** Session workspace: live state from the SSE stream, one tab per screen (#39–#46). */
export function SessionWorkspace({ initial, canRun, canApprove }: { initial: View; canRun: boolean; canApprove: boolean }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => defaultTab(initial));
  const [connection, setConnection] = useState<"live" | "offline" | "idle">(LIVE.has(initial.session.status) ? "live" : "idle");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("sessionWorkspace");
  const format = useFormatter();
  const status = view.session.status;
  const isLive = LIVE.has(status);

  // Bumped to open a new stream after the browser gave up on the old one.
  const [reconnects, setReconnects] = useState(0);

  useEffect(() => {
    if (!isLive) return;
    const source = new EventSource(`/api/sessions/${view.session.id}/events`);
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A stream that hangs silently fires no error; after 30 s without news the stored state is loaded once more.
    let lastEvent = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEvent < 30_000) return;
      lastEvent = Date.now();
      fetchJson<View>(`/api/sessions/${view.session.id}`)
        .then((next) => setView(next))
        .catch(() => {});
    }, 10_000);
    source.addEventListener("session", (event) => {
      lastEvent = Date.now();
      const next = JSON.parse((event as MessageEvent).data) as View;
      setView((previous) => {
        // Follow the run to the next phase unless the user picked another tab.
        if (previous.session.currentPhase !== next.session.currentPhase) setTab((current) => (current === defaultTab(previous) ? defaultTab(next) : current));
        return next;
      });
      setConnection("live");
    });
    source.onerror = () => {
      setConnection("offline");
      // EventSource retries a dropped stream by itself, but stops for good when a reconnect gets an error response.
      // Then load the stored state once and open a new stream (QA 07.11.26: the verdict only appeared after a reload).
      if (source.readyState === EventSource.CLOSED && !retry) {
        retry = setTimeout(() => {
          fetchJson<View>(`/api/sessions/${view.session.id}`)
            .then((next) => setView(next))
            .catch(() => {})
            .finally(() => setReconnects((n) => n + 1));
        }, 3_000);
      }
    };
    return () => {
      if (retry) clearTimeout(retry);
      clearInterval(watchdog);
      source.close();
    };
  }, [isLive, view.session.id, reconnects]);

  async function refresh() {
    setView(await fetchJson<View>(`/api/sessions/${view.session.id}`));
  }

  async function cancel() {
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/cancel`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("cancelError"));
    }
  }

  const stageOf = (phase: CouncilPhase | null) => (phase ? view.stages.find((s) => s.phase === phase) : undefined);
  // Build tabs follow the actual run, not the stored phase row (#91).
  const { exec } = useExecution(view.session.id, status === "approved");
  const built = status === "approved" ? executionStates(exec ? { plan: exec.plan, tests: exec.tests, reviews: exec.reviews } : null) : null;
  // The session counter holds actual usage plus reservations of in-flight calls; a reservation is released when its
  // call finishes, so the counter can drop (#173). Shown apart: consumed = recorded usage, reserved = the rest.
  const used = view.session.tokensUsed;
  const consumed = Math.min(
    used,
    view.usage.reduce((n, u) => n + Number(u.inputTokens) + Number(u.outputTokens), 0),
  );
  const reserved = isLive ? Math.max(0, used - consumed) : 0;
  const active = view.participants.filter((p) => p.status === "active").length;
  const budget = view.session.tokenBudget;
  const statusInfo = { text: t.has(`status.${status}`) ? t(`status.${status}`) : status, tone: STATUS_TONE[status] ?? ("neutral" as const) };
  const execText = (text: string) => (EXEC_TEXT_KEY[text] ? t(`execText.${EXEC_TEXT_KEY[text]}`) : text);
  const stateText = (state: string) => (t.has(`stageState.${state}`) ? t(`stageState.${state}`) : state);
  const newCouncil = `/projects/${view.session.projectId}/council/new`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href={`/projects/${view.project.id}`} className="hover:underline">
              {view.project.name}
            </Link>{" "}
            · {t("briefVersion", { version: view.brief.version })}
            {view.requirementList ? ` · ${t("requirementsVersion", { version: view.requirementList.version, n: view.requirementList.items.length })}` : null}
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">Council Room</h1>
          <p className="text-muted">{DECISION_MODE_LABELS[view.session.mode]}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={statusInfo.tone}>{statusInfo.text}</Badge>
            {isLive ? <Badge tone={connection === "live" ? "success" : "warning"}>{connection === "live" ? t("live") : t("reconnecting")}</Badge> : null}
            <span className="text-sm text-muted">
              {/* Started and still active models differ once one drops out (#151). */}
              {active === view.participants.length
                ? t("models", { n: view.participants.length })
                : t("startedActive", { started: view.participants.length, active })}{" "}
              · {t("perspectives", { n: view.roles.length })}
            </span>
          </div>
        </div>
        <div className="w-full max-w-xs space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("tokensUsed")}</span>
            <span>
              {format.number(isLive ? consumed : used)} / {format.number(budget)}
            </span>
          </div>
          {reserved > 0 ? <p className="text-xs text-muted">{t("reserved", { n: format.number(reserved) })}</p> : null}
          <div
            className="flex h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={isLive ? consumed : used}
            aria-label={t("budgetAria")}
          >
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, ((isLive ? consumed : used) / budget) * 100)}%` }} />
            {/* Reservations as a lighter segment after the actual usage. */}
            {reserved > 0 ? <div className="h-full bg-primary/35" style={{ width: `${Math.min(100, (reserved / budget) * 100)}%` }} /> : null}
          </div>
          {canRun && (status === "queued" || status === "running") ? (
            <Button variant="danger" className="w-full" onClick={() => void cancel()}>
              {t("stop")}
            </Button>
          ) : null}
        </div>
      </header>

      {status === "queued" && view.queue ? (
        <p className="text-sm text-muted" role="status">
          {t(view.queue.runningInWorkspace > 0 ? "queueInWorkspace" : "queue", {
            position: view.queue.ahead > 0 ? t("queueAhead", { n: view.queue.ahead }) : t("queueNext"),
            running: view.queue.running,
            inWorkspace: view.queue.runningInWorkspace,
          })}
        </p>
      ) : null}

      {status === "failed" ? (
        <Alert>
          {t("failed", { error: view.session.error ?? t("unknownError") })}{" "}
          {view.decision ? t("failedWithResults") : view.proposals.length ? t("failedWithProposals") : t("failedNothing")}{" "}
          {/rate_limit/.test(view.session.error ?? "") ? `${t("rateLimit")} ` : null}
          {/budget/i.test(view.session.error ?? "") ? null : (
            <>
              <a className="underline" href={newCouncil}>
                {t("newCouncil")}
              </a>{" "}
              – {t("newCouncilNote")}
            </>
          )}
          {/budget/i.test(view.session.error ?? "") ? (
            <>
              {t("budgetTooSmall")}{" "}
              <a className="underline" href={newCouncil}>
                {t("newCouncilBudget")}
              </a>
              .
            </>
          ) : null}
        </Alert>
      ) : null}
      {status === "cancelled" ? <Alert tone="warning">{t("cancelled")}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <nav aria-label={t("navAria")} className="relative -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
        <ol className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {TABS.map((item, index) => {
            const stage = stageOf(item.phase);
            const derived =
              built && item.id === "execution_council"
                ? { state: built.build, text: execText(built.buildText) }
                : built && item.id === "review_tests"
                  ? { state: built.reviewTests, text: execText(built.reviewTestsText) }
                  : null;
            const state = derived ? derived.state : item.phase ? (stage?.status ?? "pending") : isLive ? "running" : "completed";
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={tab === item.id ? "step" : undefined}
                  className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted hover:border-primary aria-[current=step]:border-primary aria-[current=step]:text-text"
                >
                  <span
                    className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                      state === "completed"
                        ? "bg-success/20 text-success"
                        : state === "running"
                          ? "bg-primary/20 text-primary"
                          : state === "failed"
                            ? "bg-danger/20 text-danger"
                            : state === "blocked"
                              ? "bg-warning/20 text-warning"
                              : "bg-surface-2"
                    }`}
                    aria-hidden="true"
                  >
                    {item.phase === null ? "◎" : state === "completed" ? "✓" : state === "blocked" ? "!" : state === "failed" ? "×" : index}
                  </span>
                  {item.label}
                  {derived && state === "blocked" ? <span className="text-xs text-warning">{derived.text}</span> : null}
                  <span className="sr-only">({derived ? derived.text : stateText(state)})</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="text-xs text-muted">{t("tabsNote")}</p>

      <section aria-live="polite">
        {tab === "overview" ? <CouncilRoom view={view} onOpen={(next) => setTab(next)} /> : null}
        {tab === "independent_thinking" ? <IndependentThinkingScreen view={view} /> : null}
        {tab === "open_council" ? <OpenCouncilScreen view={view} /> : null}
        {tab === "twelve_minds_council" ? <TwelveMindsScreen view={view} /> : null}
        {tab === "minority_review" || tab === "consensus_round" ? <MinorityConsensusScreen view={view} /> : null}
        {tab === "evaluation" ? <EvaluationScreen view={view} /> : null}
        {tab === "final_verdict" ? <VerdictScreen view={view} canApprove={canApprove} onChange={refresh} /> : null}
        {tab === "execution_council" ? <ExecutionScreen view={view} canApprove={canApprove} /> : null}
        {tab === "review_tests" ? <ReviewTestsScreen view={view} /> : null}
      </section>
    </div>
  );
}
