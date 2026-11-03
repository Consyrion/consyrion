"use client";

import { COUNCIL_PHASE_LABELS, DECISION_MODE_LABELS, type CouncilPhase } from "@consyrion/core/browser";
import Link from "next/link";
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

const STATUS_TEXT: Record<string, { text: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" | "accent" }> = {
  queued: { text: "Queued", tone: "neutral" },
  running: { text: "Running", tone: "primary" },
  cancel_requested: { text: "Cancelling", tone: "warning" },
  cancelled: { text: "Cancelled", tone: "neutral" },
  failed: { text: "Failed", tone: "danger" },
  awaiting_approval: { text: "Awaiting your decision", tone: "accent" },
  approved: { text: "Approved", tone: "success" },
  rejected: { text: "Rejected", tone: "neutral" },
  changes_requested: { text: "Changes requested", tone: "warning" },
};

/** The Council Room overview is the home of a session; the phase tabs hold the detailed screens. */
function defaultTab(_view: View): Tab {
  return "overview";
}

const LIVE = new Set(["queued", "running", "cancel_requested"]);

/** Session workspace: live state from the SSE stream, one tab per screen (#39–#46). */
export function SessionWorkspace({ initial, canRun, canApprove }: { initial: View; canRun: boolean; canApprove: boolean }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Tab>(() => defaultTab(initial));
  const [connection, setConnection] = useState<"live" | "offline" | "idle">(LIVE.has(initial.session.status) ? "live" : "idle");
  const [error, setError] = useState<string | null>(null);
  const status = view.session.status;
  const isLive = LIVE.has(status);

  useEffect(() => {
    if (!isLive) return;
    const source = new EventSource(`/api/sessions/${view.session.id}/events`);
    source.addEventListener("session", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as View;
      setView((previous) => {
        // Follow the run to the next phase unless the user picked another tab.
        if (previous.session.currentPhase !== next.session.currentPhase) setTab((current) => (current === defaultTab(previous) ? defaultTab(next) : current));
        return next;
      });
      setConnection("live");
    });
    source.onerror = () => setConnection("offline");
    return () => source.close();
  }, [isLive, view.session.id]);

  async function refresh() {
    setView(await fetchJson<View>(`/api/sessions/${view.session.id}`));
  }

  async function cancel() {
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/cancel`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not cancel");
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
  const statusInfo = STATUS_TEXT[status] ?? { text: status, tone: "neutral" as const };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link href={`/projects/${view.project.id}`} className="hover:underline">
              {view.project.name}
            </Link>{" "}
            · Brief v{view.brief.version}
            {view.requirementList ? ` · Requirements v${view.requirementList.version} (${view.requirementList.items.length})` : null}
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">Council Room</h1>
          <p className="text-muted">{DECISION_MODE_LABELS[view.session.mode]}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={statusInfo.tone}>{statusInfo.text}</Badge>
            {isLive ? <Badge tone={connection === "live" ? "success" : "warning"}>{connection === "live" ? "Live" : "Reconnecting…"}</Badge> : null}
            <span className="text-sm text-muted">
              {/* Started and still active models differ once one drops out (#151). */}
              {active === view.participants.length ? `${view.participants.length} models` : `${view.participants.length} started · ${active} active`} ·{" "}
              {view.roles.length} perspectives
            </span>
          </div>
        </div>
        <div className="w-full max-w-xs space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Tokens used</span>
            <span>
              {(isLive ? consumed : used).toLocaleString("en-US")} / {budget.toLocaleString("en-US")}
            </span>
          </div>
          {reserved > 0 ? (
            <p className="text-xs text-muted">
              + {reserved.toLocaleString("en-US")} reserved for running calls (released or replaced by the actual usage when they finish)
            </p>
          ) : null}
          <div
            className="flex h-2 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={isLive ? consumed : used}
            aria-label="Token budget used"
          >
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, ((isLive ? consumed : used) / budget) * 100)}%` }} />
            {/* Reservations as a lighter segment after the actual usage. */}
            {reserved > 0 ? <div className="h-full bg-primary/35" style={{ width: `${Math.min(100, (reserved / budget) * 100)}%` }} /> : null}
          </div>
          {canRun && (status === "queued" || status === "running") ? (
            <Button variant="danger" className="w-full" onClick={() => void cancel()}>
              Stop session
            </Button>
          ) : null}
        </div>
      </header>

      {status === "queued" && view.queue ? (
        <p className="text-sm text-muted" role="status">
          Waiting for a free worker slot:{" "}
          {view.queue.ahead > 0 ? `${view.queue.ahead} job${view.queue.ahead === 1 ? "" : "s"} ahead in the queue` : "next in the queue"}, {view.queue.running}{" "}
          running
          {view.queue.runningInWorkspace > 0 ? ` (${view.queue.runningInWorkspace} of them in this workspace)` : ""}.
        </p>
      ) : null}

      {status === "failed" ? (
        <Alert>
          The session failed: {view.session.error ?? "unknown error"}.{" "}
          {view.decision
            ? "Results produced so far remain visible."
            : view.proposals.length
              ? "Proposals that arrived are readable but were not debated or evaluated – this is no verdict."
              : "No proposal was revealed."}{" "}
          {/rate_limit/.test(view.session.error ?? "")
            ? "The provider reported a rate limit: wait a few minutes or choose another model of that provider. "
            : null}
          {/budget/i.test(view.session.error ?? "") ? null : (
            <>
              <a className="underline" href={`/projects/${view.session.projectId}/council/new`}>
                Start a new council
              </a>{" "}
              – it runs every phase again with the models you choose; earlier calls are not reused and are billed again by the providers.
            </>
          )}
          {/budget/i.test(view.session.error ?? "") ? (
            <>
              The token budget was too small for this team.{" "}
              <a className="underline" href={`/projects/${view.session.projectId}/council/new`}>
                Start a new council with a higher budget
              </a>
              .
            </>
          ) : null}
        </Alert>
      ) : null}
      {status === "cancelled" ? <Alert tone="warning">The session was stopped. Completed phases remain visible.</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <nav aria-label="Council phases" className="relative -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
        <ol className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {TABS.map((t, index) => {
            const stage = stageOf(t.phase);
            const derived =
              built && t.id === "execution_council"
                ? { state: built.build, text: built.buildText }
                : built && t.id === "review_tests"
                  ? { state: built.reviewTests, text: built.reviewTestsText }
                  : null;
            const state = derived ? derived.state : t.phase ? (stage?.status ?? "pending") : isLive ? "running" : "completed";
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "step" : undefined}
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
                    {t.phase === null ? "◎" : state === "completed" ? "✓" : state === "blocked" ? "!" : state === "failed" ? "×" : index}
                  </span>
                  {t.label}
                  {derived && state === "blocked" ? <span className="text-xs text-warning">{derived.text}</span> : null}
                  <span className="sr-only">({derived ? derived.text : state})</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="text-xs text-muted">
        The tabs follow the seven canonical phases. Minority Review and Consensus Round share one screen; Evaluation and Review &amp; Tests are detailed views
        of Final Verdict and Execution Council.
      </p>

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
