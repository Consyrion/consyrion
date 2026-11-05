"use client";

import type { ExecutionView } from "@consyrion/build";
import { MAX_TASK_ATTEMPTS, MIN_OVERRIDE_REASON } from "@consyrion/core/browser";
import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, fetchJson } from "@/lib/fetch-json";
import type { Jsonify } from "@/lib/types";
import { Button, buttonClasses } from "../ui/button";
import { Select } from "../ui/select";
import { Alert, Badge, Card, EmptyState } from "../ui/surface";
import { modelName, type View } from "./helpers";

type Exec = Jsonify<ExecutionView>;
const ACTIVE = new Set(["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"]);
const TEST_TONE = { passed: "success", failed: "danger", error: "danger", timeout: "warning", not_run: "neutral" } as const;

/** Latest build run of a session, polled while it is active. `enabled` = false skips loading (not approved). */
export function useExecution(sessionId: string, enabled = true) {
  const [list, setList] = useState<Array<{ id: string; status: string }> | null>(null);
  const [exec, setExec] = useState<Exec | null>(null);
  const load = useCallback(async () => {
    const { executions } = await fetchJson<{ executions: Array<{ id: string; status: string }> }>(`/api/sessions/${sessionId}/executions`);
    setList(executions);
    if (executions[0]) setExec(await fetchJson<Exec>(`/api/executions/${executions[0].id}`));
  }, [sessionId]);
  useEffect(() => {
    if (enabled) void load();
  }, [load, enabled]);
  const active = enabled && exec ? ACTIVE.has(exec.plan.status) : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 2_500);
    return () => clearInterval(timer);
  }, [active, load]);
  return { list, exec, load };
}

/** Screen #45 – Execution Council: plan, task DAG, agents, files, live status, budget, stop. */
export function ExecutionScreen({ view, canApprove }: { view: View; canApprove: boolean }) {
  const { list, exec, load } = useExecution(view.session.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [planComment, setPlanComment] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [retryModel, setRetryModel] = useState("");
  const [builder, setBuilder] = useState("");

  if (view.session.status !== "approved") {
    return <EmptyState title="Locked until a decision is approved" description="The Execution Council never starts without explicit human approval of a verdict." />;
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/executions`, { method: "POST", body: JSON.stringify(builder ? { builderParticipantId: builder } : {}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  async function createPr() {
    if (!exec) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/executions/${exec.plan.id}/pull-request`, { method: "POST", body: JSON.stringify(overrideReason.trim() ? { overrideReason } : {}) });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not create the pull request");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!exec) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/executions/${exec.plan.id}/plan`, { method: "POST", body: JSON.stringify({ action, comment: planComment.trim() || undefined }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record the plan decision");
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!exec) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/executions/${exec.plan.id}/resume`, { method: "POST", body: JSON.stringify(retryModel ? { participantId: retryModel } : {}) });
      setRetryModel("");
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not resume the run");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!exec) return;
    await fetchJson(`/api/executions/${exec.plan.id}/cancel`, { method: "POST" }).catch(() => undefined);
    await load();
  }

  if (list === null) return <p className="text-sm text-muted" role="status">Loading…</p>;
  if (!exec) {
    return (
      <Card>
        <h3 className="font-semibold">Start the Execution Council</h3>
        <p className="mt-1 text-sm text-muted">
          The approved proposal is turned into a task plan; the council&apos;s models implement the tasks, tests run only in an isolated container, failures get
          a bounded repair loop, and other models review the code. You review the plan before any code is written. Nothing is merged or deployed. Default budget: 600,000 tokens.
        </p>
        {error ? <div className="mt-3"><Alert>{error}</Alert></div> : null}
        {canApprove ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-64 text-sm">
              <span className="block font-medium">Who builds it?</span>
              <Select value={builder} onChange={(event) => setBuilder(event.target.value)} className="mt-1 w-full">
                <option value="">All council models share the tasks</option>
                {view.participants
                  .filter((p) => p.status === "active")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      Only {modelName(view, p.id)} – the others review
                    </option>
                  ))}
              </Select>
            </label>
            <Button onClick={() => void start()} disabled={busy}>
              {busy ? "Starting…" : "Start Execution Council"}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-warning">Only owners and admins can start development.</p>
        )}
      </Card>
    );
  }

  const plan = exec.plan.plan as { summary?: string; stack?: string; installCommand?: string; testCommand?: string } | null;
  const selected = exec.files.find((f) => f.path === file);
  const blocked = blockedBy(exec.tasks);
  const failedTasks = exec.tasks.filter((t) => t.status === "failed");
  const resumable = exec.plan.status === "failed" && canApprove && Boolean(exec.plan.plan) && failedTasks.length > 0 && failedTasks.every((t) => t.attempts < MAX_TASK_ATTEMPTS);
  const tokensLeft = Math.max(0, exec.plan.tokenBudget - exec.plan.tokensUsed);
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={exec.plan.status === "completed" ? "success" : exec.plan.status === "failed" ? "danger" : "primary"}>{exec.plan.status.replaceAll("_", " ")}</Badge>
            <span className="text-sm text-muted">
              {exec.usage.calls} model calls · {exec.plan.tokensUsed.toLocaleString("en-US")} / {exec.plan.tokenBudget.toLocaleString("en-US")} tokens
            </span>
          </div>
          <div className="flex gap-2">
            {ACTIVE.has(exec.plan.status) && canApprove ? (
              <Button variant="danger" onClick={() => void cancel()}>
                Stop
              </Button>
            ) : null}
            {(exec.plan.status === "failed" || exec.plan.status === "cancelled") && canApprove ? (
              // A failed or stopped run can be followed by a new one for the same approved decision.
              <Button variant={resumable ? "secondary" : "primary"} onClick={() => void start()} disabled={busy}>
                {busy ? "Starting…" : "Start a new run"}
              </Button>
            ) : null}
            {exec.files.some((f) => f.changed) || exec.deletedFiles.length ? (
              <a className={buttonClasses("secondary")} href={`/api/executions/${exec.plan.id}/patch`}>
                Download patch
              </a>
            ) : null}
            {exec.plan.pullRequestUrl ? (
              <a className={buttonClasses()} href={exec.plan.pullRequestUrl} target="_blank" rel="noreferrer">
                Draft PR #{exec.plan.pullRequestNumber}
              </a>
            ) : exec.plan.repositoryFullName && exec.plan.status === "completed" && canApprove && !readinessOf(exec).blocked ? (
              <Button onClick={() => void createPr()} disabled={busy}>
                {busy ? "Publishing…" : "Create draft pull request"}
              </Button>
            ) : null}
          </div>
        </div>
        {exec.plan.status === "awaiting_plan_approval" ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warning">
              <strong>Plan ready for review.</strong> No code has been written yet. Check the tasks below, then approve the plan to start the implementation – or
              reject it.
            </Alert>
            {canApprove ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-64 flex-1 text-sm">
                  <span className="block font-medium">Comment (optional)</span>
                  <input value={planComment} onChange={(e) => setPlanComment(e.target.value)} maxLength={2000} className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2" />
                </label>
                <Button onClick={() => void decide("approve")} disabled={busy}>
                  Approve plan and implement
                </Button>
                <Button variant="danger" onClick={() => void decide("reject")} disabled={busy}>
                  Reject plan
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">An owner or admin approves the plan.</p>
            )}
          </div>
        ) : null}
        {!exec.plan.pullRequestUrl && exec.plan.repositoryFullName && exec.plan.status === "completed" && canApprove && readinessOf(exec).blocked ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warning">
              <strong>Quality gate:</strong> {readinessOf(exec).reasons.join(" ")} Fix the change, or publish anyway with a written reason – it is recorded in the pull request and the audit log.
            </Alert>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 flex-1 text-sm">
                <span className="block font-medium">Reason for publishing anyway</span>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2"
                  placeholder="e.g. flaky test, verified manually"
                />
              </label>
              <Button variant="danger" onClick={() => void createPr()} disabled={busy || overrideReason.trim().length < MIN_OVERRIDE_REASON}>
                {busy ? "Publishing…" : "Publish draft anyway"}
              </Button>
            </div>
          </div>
        ) : null}
        {exec.plan.error ? <div className="mt-3"><Alert>{exec.plan.error}</Alert></div> : null}
        {resumable ? (
          // #107: resume from the checkpoints instead of paying for the whole run again.
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-4">
            <p className="text-sm">
              <strong>Retry only {failedTasks.map((t) => t.key).join(", ")}.</strong>{" "}
              {exec.tasks.filter((t) => t.status === "done").length ? `Finished tasks (${exec.tasks.filter((t) => t.status === "done").map((t) => t.key).join(", ")}) and their files stay as they are. ` : ""}
              {Object.keys(blocked).length ? `Waiting tasks (${Object.keys(blocked).join(", ")}) start afterwards. ` : ""}
              Expected cost: one coding call per retried task (one larger retry if the answer is cut off again), then tests and the code reviews.
              Attempt {Math.max(...failedTasks.map((t) => t.attempts)) + 1} of {MAX_TASK_ATTEMPTS} · {tokensLeft.toLocaleString("en-US")} tokens left in this run.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 text-sm">
                <span className="block font-medium">Model for the retry</span>
                <Select value={retryModel} onChange={(event) => setRetryModel(event.target.value)} className="mt-1 w-full">
                  <option value="">Same model as before</option>
                  {view.participants
                    .filter((p) => p.status === "active")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {modelName(view, p.id)}
                      </option>
                    ))}
                </Select>
              </label>
              <Button onClick={() => void resume()} disabled={busy}>
                {busy ? "Resuming…" : `Retry ${failedTasks.map((t) => t.key).join(", ")}`}
              </Button>
            </div>
          </div>
        ) : exec.plan.status === "failed" && failedTasks.some((t) => t.attempts >= MAX_TASK_ATTEMPTS) ? (
          <p className="mt-3 text-sm text-muted">
            {failedTasks.map((t) => t.key).join(", ")} failed {MAX_TASK_ATTEMPTS} times. Start a new run, or revise the decision if the task is too large for one answer.
          </p>
        ) : null}
        {error ? <div className="mt-3"><Alert>{error}</Alert></div> : null}
        {exec.plan.repositoryFullName ? (
          <p className="mt-3 text-sm">
            Repository <strong>{exec.plan.repositoryFullName}</strong> · base {exec.plan.baseBranch}
            {exec.plan.baseCommitSha ? ` @ ${exec.plan.baseCommitSha.slice(0, 7)}` : " (not imported yet)"}
            {exec.plan.snapshotSkipped?.length ? <span className="text-muted"> · {exec.plan.snapshotSkipped.length} files not sent to models (secrets, binaries, build output, limits)</span> : null}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">No repository linked: the run started from an empty workspace.</p>
        )}
        {plan ? (
          <p className="mt-3 text-sm">
            {plan.summary} · stack <strong>{plan.stack}</strong> · install <code>{plan.installCommand}</code> · tests <code>{plan.testCommand}</code>
          </p>
        ) : null}
      </Card>

      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">Task</th>
              <th className="p-3">Depends on</th>
              <th className="p-3">Agent</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {exec.tasks.map((t) => (
              <tr key={t.id}>
                <td className="p-3">
                  <strong>{t.key}</strong> {t.title}
                  {t.error ? <span className="block text-xs text-danger">{t.error}</span> : null}
                </td>
                <td className="p-3">{t.dependsOn.join(", ") || "–"}</td>
                <td className="p-3">{modelName(view, t.assignedParticipantId)}</td>
                <td className="p-3">
                  {blocked[t.key] ? (
                    <Badge tone="warning">blocked by {blocked[t.key]!.join(", ")}</Badge>
                  ) : (
                    <Badge tone={t.status === "done" ? "success" : t.status === "failed" ? "danger" : t.status === "running" ? "primary" : "neutral"}>{t.status}</Badge>
                  )}
                  {t.attempts > 1 ? <span className="mt-1 block text-xs text-muted">attempt {t.attempts}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {exec.tasks.length === 0 ? <p className="p-3 text-sm text-muted">Planning…</p> : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <h3 className="font-semibold">Files ({exec.files.filter((f) => f.changed).length} changed of {exec.files.length})</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {exec.files.map((f) => (
              <li key={f.path} className={f.changed ? "" : "opacity-60"}>
                {f.changed ? <span className="mr-1 text-success" aria-label="changed">●</span> : null}
                <button type="button" onClick={() => setFile(f.path)} className="text-left hover:text-primary aria-[current=true]:text-primary" aria-current={file === f.path}>
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold">Activity</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {exec.executions.map((e) => (
              <li key={e.id}>
                {new Date(e.createdAt).toLocaleTimeString("en-GB")} · {modelName(view, e.participantId)} · {e.kind} ({e.outcome}) – {e.summary}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          {selected ? (
            <>
              <p className="mb-2 font-mono text-sm">{selected.path}</p>
              <pre className="max-h-[480px] overflow-auto rounded-lg bg-surface-2 p-3 text-xs">
                <code>{selected.content}</code>
              </pre>
            </>
          ) : (
            <p className="text-sm text-muted">Select a file to view the generated code.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Screen #46 – tests and reviews. Only real sandbox runs and stored reviews are shown. */
export function ReviewTestsScreen({ view }: { view: View }) {
  const { exec } = useExecution(view.session.id);
  if (!exec) return <EmptyState title="No Execution Council run yet" description="Test results and reviews appear after the Execution Council has produced code." />;
  const last = exec.tests.filter((t) => !t.kind.endsWith(":install")).at(-1);
  return (
    <div className="space-y-5">
      <Card>
        <h3 className="font-semibold">Readiness</h3>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            Latest test run: {last ? <Badge tone={TEST_TONE[last.status]}>{last.status.replace("_", " ")}</Badge> : <Badge>none</Badge>}
            {last?.status === "not_run" ? <span className="text-muted"> – no container runtime on the worker; tests were not executed.</span> : null}
          </li>
          {readinessOf(exec).reasons.map((r) => (
            <li key={r} className="text-danger">
              Blocks the pull request: {r}
            </li>
          ))}
          {readinessOf(exec).warnings.map((w) => (
            <li key={w} className="text-warning">
              {w}
            </li>
          ))}
          <li>
            Reviews: {exec.reviews.length} ({exec.reviews.filter((r) => r.verdict === "approve").length} approve,{" "}
            {exec.reviews.filter((r) => r.verdict === "request_changes").length} request changes)
          </li>
          <li>
            Pull request:{" "}
            {exec.plan.pullRequestUrl ? (
              <a className="text-primary underline" href={exec.plan.pullRequestUrl} target="_blank" rel="noreferrer">
                draft #{exec.plan.pullRequestNumber}
              </a>
            ) : exec.plan.repositoryFullName ? (
              "not created yet"
            ) : (
              "link a GitHub repository to the project to publish changes as a pull request"
            )}
            . Merging always happens in GitHub by a human.
          </li>
          {exec.plan.pullRequestUrl ? <ChecksList planId={exec.plan.id} /> : null}
        </ul>
      </Card>
      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">Run</th>
              <th className="p-3">Command</th>
              <th className="p-3">Sandbox</th>
              <th className="p-3">Result</th>
              <th className="p-3">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {exec.tests.map((t) => (
              <tr key={t.id}>
                <td className="p-3">{t.kind}</td>
                <td className="p-3 font-mono text-xs">{t.command}</td>
                <td className="p-3">{t.sandbox}</td>
                <td className="p-3">
                  <Badge tone={TEST_TONE[t.status]}>{t.status.replace("_", " ")}</Badge>
                  {t.exitCode !== null ? <span className="text-xs text-muted"> exit {t.exitCode}</span> : null}
                </td>
                <td className="p-3">{(t.durationMs / 1000).toFixed(1)} s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {last?.output ? (
        <Card>
          <h3 className="font-semibold">Output of the latest run</h3>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{last.output}</pre>
        </Card>
      ) : null}
      {exec.reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">Review: {r.focus}</h3>
            <Badge tone={r.verdict === "approve" ? "success" : "warning"}>{r.verdict.replace("_", " ")}</Badge>
            <span className="text-sm text-muted">{modelName(view, r.reviewerParticipantId)}</span>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {(r.findings as Array<{ severity: string; file: string; issue: string; suggestion: string }>).map((f, i) => (
              <li key={i}>
                <Badge tone={f.severity === "critical" || f.severity === "high" ? "danger" : "neutral"}>{f.severity}</Badge> <span className="font-mono text-xs">{f.file}</span> – {f.issue}{" "}
                <span className="text-muted">({f.suggestion})</span>
              </li>
            ))}
            {(r.findings as unknown[]).length === 0 ? <li className="text-muted">No findings.</li> : null}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function ChecksList({ planId }: { planId: string }) {
  const [checks, setChecks] = useState<Array<{ name: string; status: string; conclusion: string | null; url: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchJson<{ checks: Array<{ name: string; status: string; conclusion: string | null; url: string }> }>(`/api/executions/${planId}/checks`)
      .then((r) => setChecks(r.checks))
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : "Could not load CI status"));
  }, [planId]);
  if (error) return <li className="text-danger">{error}</li>;
  if (!checks) return <li className="text-muted">Loading CI status…</li>;
  if (!checks.length) return <li className="text-muted">No CI checks reported for the pull request yet.</li>;
  return (
    <li>
      CI checks:{" "}
      {checks.map((c) => (
        <a key={c.name} href={c.url} target="_blank" rel="noreferrer" className="mr-2 inline-flex">
          <Badge tone={c.conclusion === "success" ? "success" : c.conclusion === "failure" ? "danger" : "neutral"}>
            {c.name}: {c.conclusion ?? c.status}
          </Badge>
        </a>
      ))}
    </li>
  );
}

/** Pending tasks that cannot start because a task they depend on (directly or indirectly) failed. */
export function blockedBy(tasks: Array<{ key: string; status: string; dependsOn: string[] }>): Record<string, string[]> {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const result: Record<string, string[]> = {};
  const failedRoots = (key: string, seen = new Set<string>()): string[] => {
    const task = byKey.get(key);
    if (!task || seen.has(key)) return [];
    seen.add(key);
    if (task.status === "failed") return [key];
    return [...new Set(task.dependsOn.flatMap((dep) => failedRoots(dep, seen)))];
  };
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const roots = [...new Set(task.dependsOn.flatMap((dep) => failedRoots(dep)))];
    if (roots.length) result[task.key] = roots.sort();
  }
  return result;
}

/** The quality gate the server enforces before a draft pull request, as computed by the server (#189). */
function readinessOf(exec: Jsonify<ExecutionView>) {
  return exec.readiness;
}
