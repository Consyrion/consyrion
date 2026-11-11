"use client";

import type { ExecutionView } from "@consyrium/build";
import { MAX_TASK_ATTEMPTS, MIN_OVERRIDE_REASON } from "@consyrium/core/browser";
import { useFormatter, useTranslations } from "next-intl";
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
// Default token budget of a run, as set by the server (shown in the start card).
const DEFAULT_BUDGET = 600_000;

/** Translated label for a server status/enum value, falling back to the raw value with spaces. */
function useStatusLabel() {
  const t = useTranslations("executionScreen.status");
  return (group: "plan" | "task" | "test" | "verdict" | "severity", value: string) =>
    t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value.replaceAll("_", " ");
}

/**
 * Text audit 08.11.26: the build tab showed stored English sentences and raw values ("implement (ok)", "not_run",
 * "Not executed: the install step could not run (no sandbox)."). Known ones are shown in the interface language;
 * everything else (model summaries, real test output) stays as stored.
 */
export function useBuildText() {
  const t = useTranslations("executionScreen.buildText");
  const known = (text: string): string | null => {
    if (text === "The answer did not match the required structure") return t("badStructure");
    if (text === "No container runtime is available; the command was not executed.") return t("noRuntime");
    let m = /^Not executed: the install step could not run \(no sandbox\)\.$/.exec(text);
    if (m) return t("installNoSandbox");
    m = /^Not executed: the install step ended with (\w+)\.$/.exec(text);
    if (m) return t("installEnded", { status: t.has(`testStatus.${m[1]}`) ? t(`testStatus.${m[1]}` as never) : m[1]! });
    return null;
  };
  return {
    /** A stored summary or output: known sentences translated, "Rejected:" lines labelled, the rest unchanged. */
    text: (text: string) =>
      text
        .split("\n")
        .map((line) => known(line) ?? (line.startsWith("Rejected: ") ? `${t("rejected")} ${line.slice("Rejected: ".length)}` : line))
        .join("\n"),
    kind: (kind: string) => (t.has(`kind.${kind}`) ? t(`kind.${kind}` as never) : kind),
    outcome: (outcome: string) => (t.has(`outcome.${outcome}`) ? t(`outcome.${outcome}` as never) : outcome.replaceAll("_", " ")),
    /** Test run kinds: "test", "repair-2", "test:install", "repair-2:install". */
    testKind: (kind: string) => {
      const m = /^(test|repair)(?:-(\d+))?(:install)?$/.exec(kind);
      if (!m) return kind;
      const base = m[1] === "repair" ? t("testKind.repair", { n: Number(m[2] ?? 1) }) : t("testKind.test");
      return m[3] ? t("testKind.install", { base }) : base;
    },
    check: (value: string) => (t.has(`check.${value}`) ? t(`check.${value}` as never) : value.replaceAll("_", " ")),
    /** Night test R4: the stored review focus and sandbox name were shown raw (English / "none"). */
    focus: (value: string) => (value.startsWith("code quality") ? t("focus.quality") : value.startsWith("security") ? t("focus.security") : value),
    sandbox: (value: string) => (t.has(`sandbox.${value}`) ? t(`sandbox.${value}` as never) : value),
  };
}

/** Latest build run of a session, polled while it is active. `enabled` = false skips loading (not approved). */
export function useExecution(sessionId: string, enabled = true) {
  const [list, setList] = useState<Array<{ id: string; status: string }> | null>(null);
  const [exec, setExec] = useState<Exec | null>(null);
  const load = useCallback(async () => {
    const { executions } = await fetchJson<{ executions: Array<{ id: string; status: string }> }>(`/api/sessions/${sessionId}/executions`);
    // Load the latest run before showing the list (ChatGPT test 06.11.26): setting the list first rendered the start
    // card for a moment although a finished run exists.
    const latest = executions[0] ? await fetchJson<Exec>(`/api/executions/${executions[0].id}`) : null;
    setExec(latest);
    setList(executions);
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
  // #400: CI-relevant changes (scripts, lockfiles, build config) are confirmed explicitly before the draft PR.
  const [ciConfirmed, setCiConfirmed] = useState(false);
  const [planComment, setPlanComment] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [retryModel, setRetryModel] = useState("");
  const [builder, setBuilder] = useState("");
  // Night test R4 (ChatGPT P2): the build had a fixed 600,000-token ceiling; the user sets their own (20,000–5,000,000).
  const [buildBudget, setBuildBudget] = useState(600_000);
  const t = useTranslations("executionScreen");
  const buildText = useBuildText();
  const format = useFormatter();
  const label = useStatusLabel();

  // #249 part 2 (variant B): a session still waiting for a decision builds only its approved prototype/measurement build.
  const prototypeOnly = view.session.status === "awaiting_approval" && view.humanMark?.kind === "prototype_build";
  // #548: nothing is built in an archived project – the server refuses it, so the screen says why.
  if ((view.project as { status?: string }).status === "archived") {
    return <EmptyState title={t("lockedTitle")} description={t("archivedText")} />;
  }
  if (view.session.status !== "approved" && !prototypeOnly) {
    return <EmptyState title={t("lockedTitle")} description={t("lockedText")} />;
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/sessions/${view.session.id}/executions`, {
        method: "POST",
        body: JSON.stringify({ ...(builder ? { builderParticipantId: builder } : {}), tokenBudget: buildBudget }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errorStart"));
    } finally {
      setBusy(false);
    }
  }

  async function createPr() {
    if (!exec) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/executions/${exec.plan.id}/pull-request`, {
        method: "POST",
        body: JSON.stringify({ ...(overrideReason.trim() ? { overrideReason } : {}), ...(ciConfirmed ? { confirmCiChanges: true } : {}) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("errorPr"));
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
      setError(err instanceof ApiRequestError ? err.message : t("errorPlan"));
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
      setError(err instanceof ApiRequestError ? err.message : t("errorResume"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!exec) return;
    await fetchJson(`/api/executions/${exec.plan.id}/cancel`, { method: "POST" }).catch(() => undefined);
    await load();
  }

  if (list === null)
    return (
      <p className="text-sm text-muted" role="status">
        {t("loading")}
      </p>
    );
  if (!exec) {
    return (
      <Card>
        <h3 className="font-semibold">{prototypeOnly ? t("prototypeStartTitle") : t("startTitle")}</h3>
        {prototypeOnly ? (
          <div className="mt-2">
            <Alert tone="warning">{t("prototypeNotice")}</Alert>
          </div>
        ) : null}
        <p className="mt-1 text-sm text-muted">{t("startText", { budget: format.number(DEFAULT_BUDGET) })}</p>
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        {canApprove ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-64 text-sm">
              <span className="block font-medium">{t("whoBuilds")}</span>
              <Select value={builder} onChange={(event) => setBuilder(event.target.value)} className="mt-1 w-full">
                <option value="">{t("allModels")}</option>
                {view.participants
                  .filter((p) => p.status === "active")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {t("onlyModelReview", { model: modelName(view, p.id) })}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="w-48 text-sm">
              <span className="block font-medium">{t("buildBudget")}</span>
              <input
                type="number"
                min={20_000}
                max={5_000_000}
                step={10_000}
                value={buildBudget}
                onChange={(event) => setBuildBudget(Number(event.target.value))}
                className="mt-1 min-h-10 w-full rounded-xl border border-glass-line bg-surface px-3 py-2 text-sm"
              />
            </label>
            <Button onClick={() => void start()} disabled={busy || !(buildBudget >= 20_000 && buildBudget <= 5_000_000)}>
              {busy ? t("starting") : t("start")}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-warning">{t("ownersOnly")}</p>
        )}
      </Card>
    );
  }

  const plan = exec.plan.plan as { summary?: string; stack?: string; installCommand?: string; testCommand?: string } | null;
  const selected = exec.files.find((f) => f.path === file);
  const blocked = blockedBy(exec.tasks);
  const failedTasks = exec.tasks.filter((t) => t.status === "failed");
  const resumable =
    exec.plan.status === "failed" &&
    canApprove &&
    Boolean(exec.plan.plan) &&
    failedTasks.length > 0 &&
    failedTasks.every((t) => t.attempts < MAX_TASK_ATTEMPTS);
  const tokensLeft = Math.max(0, exec.plan.tokenBudget - exec.plan.tokensUsed);
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={exec.plan.status === "completed" ? "success" : exec.plan.status === "failed" ? "danger" : "primary"}>
              {label("plan", exec.plan.status)}
            </Badge>
            {exec.plan.kind === "prototype" ? (
              <span title={t("prototypeNotice")} data-testid="prototype-build">
                <Badge tone="warning">{t("prototypeBadge")}</Badge>
              </span>
            ) : null}
            <span className="text-sm text-muted">
              {t("usage", { calls: exec.usage.calls, used: format.number(exec.plan.tokensUsed), budget: format.number(exec.plan.tokenBudget) })}
            </span>
          </div>
          <div className="flex gap-2">
            {ACTIVE.has(exec.plan.status) && canApprove ? (
              <Button variant="danger" onClick={() => void cancel()}>
                {t("stop")}
              </Button>
            ) : null}
            {(exec.plan.status === "failed" || exec.plan.status === "cancelled") && canApprove ? (
              // A failed or stopped run can be followed by a new one for the same approved decision, with its own builder.
              <>
                <Select aria-label={t("whoBuildsNew")} value={builder} onChange={(event) => setBuilder(event.target.value)} className="min-w-56">
                  <option value="">{t("allModels")}</option>
                  {view.participants
                    .filter((p) => p.status === "active")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {t("onlyModel", { model: modelName(view, p.id) })}
                      </option>
                    ))}
                </Select>
                <Button variant={resumable ? "secondary" : "primary"} onClick={() => void start()} disabled={busy}>
                  {busy ? t("starting") : t("newRun")}
                </Button>
              </>
            ) : null}
            {exec.files.some((f) => f.changed) || exec.deletedFiles.length ? (
              <a className={buttonClasses("secondary")} href={`/api/executions/${exec.plan.id}/patch`}>
                {t("downloadPatch")}
              </a>
            ) : null}
            {exec.plan.pullRequestUrl ? (
              <a className={buttonClasses()} href={exec.plan.pullRequestUrl} target="_blank" rel="noreferrer">
                {t("draftPr", { n: exec.plan.pullRequestNumber ?? "" })}
              </a>
            ) : exec.plan.repositoryFullName && exec.plan.status === "completed" && canApprove && !readinessOf(exec).blocked ? (
              <Button onClick={() => void createPr()} disabled={busy || (exec.ciRisks.length > 0 && !ciConfirmed)}>
                {busy ? t("publishing") : t("createPr")}
              </Button>
            ) : null}
          </div>
        </div>
        {exec.plan.status === "awaiting_plan_approval" ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warning">{t.rich("planReady", { strong: (chunks) => <strong>{chunks}</strong> })}</Alert>
            {canApprove ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-64 flex-1 text-sm">
                  <span className="block font-medium">{t("comment")}</span>
                  <input
                    value={planComment}
                    onChange={(e) => setPlanComment(e.target.value)}
                    maxLength={2000}
                    className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2"
                  />
                </label>
                <Button onClick={() => void decide("approve")} disabled={busy}>
                  {t("approvePlan")}
                </Button>
                <Button variant="danger" onClick={() => void decide("reject")} disabled={busy}>
                  {t("rejectPlan")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">{t("ownerApproves")}</p>
            )}
          </div>
        ) : null}
        {!exec.plan.pullRequestUrl && exec.plan.repositoryFullName && exec.plan.status === "completed" && canApprove && exec.ciRisks.length ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warning">{t.rich("ciRisksIntro", { strong: (chunks) => <strong>{chunks}</strong> })}</Alert>
            <ul className="space-y-1 text-sm">
              {exec.ciRisks.map((risk) => (
                <li key={`${risk.path}:${risk.reason}`}>
                  <button type="button" className="font-mono text-primary underline" onClick={() => setFile(risk.path)}>
                    {risk.path}
                  </button>{" "}
                  – {t(`ciRisk.${risk.reason}`)}
                  {risk.detail ? <span className="text-muted"> ({risk.detail})</span> : null}
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ciConfirmed} onChange={(e) => setCiConfirmed(e.target.checked)} />
              <span>{t("ciRisksConfirm")}</span>
            </label>
          </div>
        ) : null}
        {!exec.plan.pullRequestUrl && exec.plan.repositoryFullName && exec.plan.status === "completed" && canApprove && readinessOf(exec).blocked ? (
          <div className="mt-3 space-y-2">
            <Alert tone="warning">
              {t.rich("qualityGate", { reasons: readinessOf(exec).reasons.join(" "), strong: (chunks) => <strong>{chunks}</strong> })}
            </Alert>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 flex-1 text-sm">
                <span className="block font-medium">{t("overrideReason")}</span>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2"
                  placeholder={t("overridePlaceholder")}
                />
              </label>
              <Button
                variant="danger"
                onClick={() => void createPr()}
                disabled={busy || overrideReason.trim().length < MIN_OVERRIDE_REASON || (exec.ciRisks.length > 0 && !ciConfirmed)}
              >
                {busy ? t("publishing") : t("publishAnyway")}
              </Button>
            </div>
          </div>
        ) : null}
        {exec.plan.error ? (
          <div className="mt-3">
            <Alert>{exec.plan.error}</Alert>
          </div>
        ) : null}
        {resumable ? (
          // #107: resume from the checkpoints instead of paying for the whole run again.
          <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/60 p-4">
            <p className="text-sm">
              <strong>{t("retryOnly", { tasks: failedTasks.map((task) => task.key).join(", ") })}</strong>{" "}
              {exec.tasks.filter((task) => task.status === "done").length
                ? `${t("finishedKept", {
                    tasks: exec.tasks
                      .filter((task) => task.status === "done")
                      .map((task) => task.key)
                      .join(", "),
                  })} `
                : ""}
              {Object.keys(blocked).length ? `${t("waitingAfter", { tasks: Object.keys(blocked).join(", ") })} ` : ""}
              {t("retryCost", {
                attempt: Math.max(...failedTasks.map((task) => task.attempts)) + 1,
                max: MAX_TASK_ATTEMPTS,
                tokens: format.number(tokensLeft),
              })}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-64 text-sm">
                <span className="block font-medium">{t("retryModel")}</span>
                <Select value={retryModel} onChange={(event) => setRetryModel(event.target.value)} className="mt-1 w-full">
                  <option value="">{t("sameModel")}</option>
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
                {busy ? t("resuming") : t("retry", { tasks: failedTasks.map((task) => task.key).join(", ") })}
              </Button>
            </div>
          </div>
        ) : exec.plan.status === "failed" && failedTasks.some((t) => t.attempts >= MAX_TASK_ATTEMPTS) ? (
          <p className="mt-3 text-sm text-muted">{t("failedTooOften", { tasks: failedTasks.map((task) => task.key).join(", "), max: MAX_TASK_ATTEMPTS })}</p>
        ) : null}
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        {exec.plan.repositoryFullName ? (
          <p className="mt-3 text-sm">
            {t.rich("repository", { repo: exec.plan.repositoryFullName, branch: exec.plan.baseBranch ?? "", strong: (chunks) => <strong>{chunks}</strong> })}
            {exec.plan.baseCommitSha ? ` @ ${exec.plan.baseCommitSha.slice(0, 7)}` : ` ${t("notImported")}`}
            {exec.plan.snapshotSkipped?.length ? <span className="text-muted"> · {t("skippedFiles", { n: exec.plan.snapshotSkipped.length })}</span> : null}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">{t("noRepository")}</p>
        )}
        {plan ? (
          <p className="mt-3 text-sm">
            {t.rich("planLine", {
              summary: plan.summary ?? "",
              stack: plan.stack ?? "",
              install: plan.installCommand ?? "",
              test: plan.testCommand ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        ) : null}
      </Card>

      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">{t("colTask")}</th>
              <th className="p-3">{t("colDepends")}</th>
              <th className="p-3">{t("colAgent")}</th>
              <th className="p-3">{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {exec.tasks.map((task) => (
              <tr key={task.id}>
                <td className="p-3">
                  <strong>{task.key}</strong> {task.title}
                  {task.error ? <span className="block text-xs text-danger">{task.error}</span> : null}
                </td>
                <td className="p-3">{task.dependsOn.join(", ") || "–"}</td>
                <td className="p-3">{modelName(view, task.assignedParticipantId)}</td>
                <td className="p-3">
                  {blocked[task.key] ? (
                    <Badge tone="warning">{t("blockedBy", { tasks: blocked[task.key]!.join(", ") })}</Badge>
                  ) : (
                    <Badge tone={task.status === "done" ? "success" : task.status === "failed" ? "danger" : task.status === "running" ? "primary" : "neutral"}>
                      {label("task", task.status)}
                    </Badge>
                  )}
                  {task.attempts > 1 ? <span className="mt-1 block text-xs text-muted">{t("attempt", { n: task.attempts })}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {exec.tasks.length === 0 ? <p className="p-3 text-sm text-muted">{t("planning")}</p> : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <h3 className="font-semibold">{t("files", { changed: exec.files.filter((f) => f.changed).length, total: exec.files.length })}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {exec.files.map((f) => (
              <li key={f.path} className={f.changed ? "" : "opacity-60"}>
                {f.changed ? (
                  <span className="mr-1 text-success" aria-label={t("changed")}>
                    ●
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setFile(f.path)}
                  className="text-left hover:text-primary aria-[current=true]:text-primary"
                  aria-current={file === f.path}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold">{t("activity")}</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {exec.executions.map((e) => (
              <li key={e.id}>
                {format.dateTime(new Date(e.createdAt), { timeStyle: "medium" })} · {modelName(view, e.participantId)} · {buildText.kind(e.kind)} (
                {buildText.outcome(e.outcome)}) – {buildText.text(e.summary)}
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
            <p className="text-sm text-muted">{t("selectFile")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * GitHub build test 08.11.26: the readiness reasons and warnings (packages/core/src/readiness.ts) are English sentences;
 * the known ones are shown in the interface language, anything else as sent.
 */
function useReadinessText() {
  const t = useTranslations("executionScreen.readinessText");
  return (text: string): string => {
    if (text.startsWith("Tests were not executed by CONSYRIUM AI")) return t("notRunGithub");
    // Pattern, not the literal sentence: the readiness wording is a bundle marker (scripts/check-client-bundle.mjs).
    if (/^No sandbox test run exists for this/.test(text)) return t("noRun");
    let m = /^Installing dependencies (timed out|failed) in the latest sandbox run\.$/.exec(text);
    if (m) return t(m[1] === "timed out" ? "installTimeout" : "installFailed");
    m = /^The latest sandbox test run (timed out|errored|failed)\.$/.exec(text);
    if (m) return t(m[1] === "timed out" ? "runTimeout" : m[1] === "errored" ? "runError" : "runFailed");
    m = /^(\d+) high-severity review finding\(s\) – check them before merging\.$/.exec(text);
    if (m) return t("highFindings", { n: Number(m[1]) });
    m = /^(\d+) critical review finding\(s\): (.*)$/.exec(text);
    if (m) return t("criticalFindings", { n: Number(m[1]), list: m[2]! });
    return text;
  };
}

/** Screen #46 – tests and reviews. Only real sandbox runs and stored reviews are shown. */
export function ReviewTestsScreen({ view }: { view: View }) {
  const { exec } = useExecution(view.session.id);
  const t = useTranslations("executionScreen");
  const buildText = useBuildText();
  const format = useFormatter();
  const label = useStatusLabel();
  const readinessText = useReadinessText();
  if (!exec) return <EmptyState title={t("noRunTitle")} description={t("noRunText")} />;
  const last = exec.tests.filter((t) => !t.kind.endsWith(":install")).at(-1);
  return (
    <div className="space-y-5">
      <Card>
        <h3 className="font-semibold">{t("readiness")}</h3>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            {t.rich("latestRun", {
              badge: () => (last ? <Badge tone={TEST_TONE[last.status]}>{label("test", last.status)}</Badge> : <Badge>{t("none")}</Badge>),
            })}
            {last?.status === "not_run" ? <span className="text-muted"> – {t("notRunHint")}</span> : null}
          </li>
          {readinessOf(exec).reasons.map((r) => (
            <li key={r} className="text-danger">
              {t("blocksPr", { reason: readinessText(r) })}
            </li>
          ))}
          {readinessOf(exec).warnings.map((w) => (
            <li key={w} className="text-warning">
              {readinessText(w)}
            </li>
          ))}
          <li>
            {t("reviewsLine", {
              total: exec.reviews.length,
              approve: exec.reviews.filter((r) => r.verdict === "approve").length,
              changes: exec.reviews.filter((r) => r.verdict === "request_changes").length,
            })}
          </li>
          <li>
            {exec.plan.pullRequestUrl
              ? t.rich("prLine", {
                  n: exec.plan.pullRequestNumber ?? "",
                  link: (chunks) => (
                    <a className="text-primary underline" href={exec.plan.pullRequestUrl!} target="_blank" rel="noreferrer">
                      {chunks}
                    </a>
                  ),
                })
              : exec.plan.repositoryFullName
                ? t("prNotCreated")
                : t("prNoRepository")}
          </li>
          {exec.plan.pullRequestUrl ? (
            <ChecksList
              planId={exec.plan.id}
              buildChecks={(view.requirementList?.items ?? []).filter((i) => (i as { verification?: string | null }).verification === "build")}
            />
          ) : null}
        </ul>
      </Card>
      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th className="p-3">{t("colRun")}</th>
              <th className="p-3">{t("colCommand")}</th>
              <th className="p-3">{t("colSandbox")}</th>
              <th className="p-3">{t("colResult")}</th>
              <th className="p-3">{t("colDuration")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {exec.tests.map((test) => (
              <tr key={test.id}>
                <td className="p-3">{buildText.testKind(test.kind)}</td>
                <td className="p-3 font-mono text-xs">{test.command}</td>
                <td className="p-3">{buildText.sandbox(test.sandbox)}</td>
                <td className="p-3">
                  <Badge tone={TEST_TONE[test.status]}>{label("test", test.status)}</Badge>
                  {test.exitCode !== null ? <span className="text-xs text-muted"> {t("exitCode", { code: test.exitCode })}</span> : null}
                </td>
                <td className="p-3">{t("seconds", { s: format.number(test.durationMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {last?.output ? (
        <Card>
          <h3 className="font-semibold">{t("latestOutput")}</h3>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{buildText.text(last.output)}</pre>
        </Card>
      ) : null}
      {exec.reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t("reviewTitle", { focus: buildText.focus(r.focus) })}</h3>
            <Badge tone={r.verdict === "approve" ? "success" : "warning"}>{label("verdict", r.verdict)}</Badge>
            <span className="text-sm text-muted">{modelName(view, r.reviewerParticipantId)}</span>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {(r.findings as Array<{ severity: string; file: string; issue: string; suggestion: string }>).map((f, i) => (
              <li key={i}>
                <Badge tone={f.severity === "critical" || f.severity === "high" ? "danger" : "neutral"}>{label("severity", f.severity)}</Badge>{" "}
                <span className="font-mono text-xs">{f.file}</span> – {f.issue} <span className="text-muted">({f.suggestion})</span>
              </li>
            ))}
            {(r.findings as unknown[]).length === 0 ? <li className="text-muted">{t("noFindings")}</li> : null}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/**
 * Night test R4 (ChatGPT): a build check is proven by the real GitHub checks of the pull request, never by the council.
 * verified = every check passed, failed = any check failed, pending = still running or none yet.
 */
export function buildCheckProof(checks: Array<{ status: string; conclusion: string | null }>): "verified" | "failed" | "pending" {
  if (checks.some((c) => ["failure", "cancelled", "timed_out", "action_required"].includes(c.conclusion ?? ""))) return "failed";
  if (checks.length > 0 && checks.every((c) => c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral")) return "verified";
  return "pending";
}

function ChecksList({ planId, buildChecks = [] }: { planId: string; buildChecks?: Array<{ id: string; text: string }> }) {
  const [checks, setChecks] = useState<Array<{ name: string; status: string; conclusion: string | null; url: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("executionScreen");
  const buildText = useBuildText();
  useEffect(() => {
    fetchJson<{ checks: Array<{ name: string; status: string; conclusion: string | null; url: string }> }>(`/api/executions/${planId}/checks`)
      .then((r) => setChecks(r.checks))
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : t("errorChecks")));
  }, [planId]);
  if (error) return <li className="text-danger">{error}</li>;
  if (!checks) return <li className="text-muted">{t("loadingChecks")}</li>;
  const proof = buildCheckProof(checks);
  const proofList = buildChecks.length ? (
    <ul className="mt-2 space-y-1" data-testid="build-check-proof">
      {buildChecks.map((r) => (
        <li key={r.id}>
          <Badge tone={proof === "verified" ? "success" : proof === "failed" ? "danger" : "warning"}>{t(`buildProof.${proof}`)}</Badge> <strong>{r.id}</strong>{" "}
          {r.text}
        </li>
      ))}
    </ul>
  ) : null;
  if (!checks.length)
    return (
      <li className="text-muted">
        {t("noChecks")}
        {proofList}
      </li>
    );
  return (
    <li>
      {t("ciChecks")}{" "}
      {checks.map((c) => (
        <a key={c.name} href={c.url} target="_blank" rel="noreferrer" className="mr-2 inline-flex">
          <Badge tone={c.conclusion === "success" ? "success" : c.conclusion === "failure" ? "danger" : "neutral"}>
            {c.name}: {buildText.check(c.conclusion ?? c.status)}
          </Badge>
        </a>
      ))}
      {proofList}
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
