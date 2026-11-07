import { getExecutionView, listExecutions } from "@consyrion/build";
import { getSessionView, listSessionParticipants, listSessions } from "@consyrion/council";
import { can, COUNCIL_PHASE_LABELS, COUNCIL_PHASES, type CouncilPhase } from "@consyrion/core";
import { listCredentials, listProjects } from "@consyrion/db";
import { sql } from "@consyrion/db/sql";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityNetwork } from "@/components/dashboard/activity-network";
import { PROVIDER_COLOR, PROVIDER_NAME, type ActivityNode } from "@/components/dashboard/activity-network-data";
import { EmptyCouncil } from "@/components/dashboard/empty-council";
import { LiveCouncilCompact } from "@/components/dashboard/live-council-compact";
import { stepStatesFor, WorkflowStepper, type StepState } from "@/components/dashboard/workflow-stepper";
import { executionStates } from "@/components/session/execution-status";
import { roleLabel } from "@/components/session/helpers";
import { buttonClasses } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass";
import { Icon, type IconName } from "@/components/ui/icons";
import { Badge } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("metaTitle") };
}

const LIVE = new Set(["queued", "running", "cancel_requested"]);
/** Badge tone per session status; the label comes from `decisions.status.<status>` (fallback: the raw value). */
const STATUS_TONE: Record<string, "primary" | "warning" | "success" | "danger" | "neutral"> = {
  queued: "primary",
  running: "primary",
  cancel_requested: "warning",
  awaiting_approval: "warning",
  approved: "success",
  rejected: "neutral",
  changes_requested: "warning",
  failed: "danger",
  cancelled: "neutral",
};

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n);
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

function relative(t: Translate, date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t("ago.now");
  if (minutes < 60) return t("ago.minutes", { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24 ? t("ago.hours", { n: hours }) : t("ago.days", { n: Math.round(hours / 24) });
}

async function databaseHealthy() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function Metric({ href, icon, label, value, tone, className = "" }: { href: string; icon: IconName; label: string; value: number; tone: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-2xl border p-3.5 transition-colors hover:brightness-125 md:gap-4 md:p-4 ${className}`}
      style={{
        borderColor: `color-mix(in oklab, ${tone} 38%, transparent)`,
        background: `linear-gradient(120deg, color-mix(in oklab, ${tone} 16%, transparent), color-mix(in oklab, var(--surface) 70%, transparent) 70%)`,
      }}
    >
      <span
        className="grid size-10 shrink-0 place-items-center rounded-xl border md:size-12"
        style={{ color: tone, borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`, background: `color-mix(in oklab, ${tone} 14%, transparent)`, boxShadow: `0 0 18px -6px ${tone}` }}
      >
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight text-muted">{label}</span>
        <span className="block font-[family-name:var(--font-display)] text-2xl leading-tight font-semibold md:text-3xl">{value}</span>
      </span>
      <Icon name="chevron" className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** The one next step, highlighted with a cyan contour and a real primary button (design concept 1/3, #82). */
function NextAction({ href, icon, title, text, action }: { href: string; icon: IconName; title: string; text: string; action: string }) {
  return (
    <div className="rounded-2xl border border-[#22d3ee]/55 bg-[linear-gradient(135deg,rgb(34_211_238/0.14),rgb(139_92_246/0.08))] p-4 shadow-[0_0_32px_-12px_rgb(34_211_238/0.7)]">
      <div className="flex items-start gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-[#22d3ee]/45 bg-surface/70 text-primary">
          <Icon name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-display)] text-lg leading-snug font-semibold break-words">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{text}</p>
        </div>
      </div>
      <Link href={href} className={buttonClasses("primary", "mt-4 h-11 w-full rounded-xl text-[15px] font-semibold")}>
        {action} <Icon name="arrow" className="size-4" />
      </Link>
    </div>
  );
}

function PanelHeading({ title, href, children }: { title: string; href?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold md:text-xl">
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 hover:text-primary">
            {title} <Icon name="chevron" className="size-4" />
          </Link>
        ) : (
          title
        )}
      </h2>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const actor = await requirePageActor();
  const t = await getTranslations("dashboard");
  const tStatus = await getTranslations("decisions.status");
  const statusOf = (status: string) => ({ text: tStatus.has(status) ? tStatus(status) : status, tone: STATUS_TONE[status] ?? ("neutral" as const) });
  const db = await getDb();
  const [projects, sessions, credentials, dbOk] = await Promise.all([
    listProjects(db, actor),
    listSessions(db, actor),
    can(actor.role, "credential:read") ? listCredentials(db, actor) : Promise.resolve([]),
    databaseHealthy(),
  ]);
  const activeProjects = projects.filter((p) => p.status !== "archived");
  const awaiting = sessions.filter((s) => s.status === "awaiting_approval");
  const running = sessions.filter((s) => LIVE.has(s.status));
  const recent = sessions.slice(0, 6);
  const participants = await listSessionParticipants(db, actor, recent.map((s) => s.id));
  const verified = credentials.filter((c) => c.lastValidatedAt && !c.lastValidationError);

  // Council activity shows the live session, else the one waiting for a decision, else the latest one.
  const featured = running[0] ?? awaiting[0] ?? sessions[0];
  const view = featured ? await getSessionView(db, actor, featured.id) : null;
  const phase = (view?.session.currentPhase ?? null) as CouncilPhase | null;
  const live = view ? LIVE.has(view.session.status) : false;
  const nodes: ActivityNode[] = (view?.participants ?? []).map((p) => {
    const answered = view!.usage.some((u) => u.participantId === p.id && u.phase === phase && u.outcome === "ok");
    // Queued sessions have no request in flight yet; a council that ended without a verdict leaves unanswered models idle (#106).
    const status = view!.session.status;
    const state = p.status === "failed" ? "failed" : status === "queued" ? "idle" : live ? (answered ? "done" : "working") : status === "failed" || status === "cancelled" ? (answered ? "done" : "idle") : "done";
    // Real figures for the hover card: roles from the assignment, calls and tokens from usage records.
    const usage = view!.usage.filter((u) => u.participantId === p.id);
    const details = {
      roles: view!.roles.filter((r) => r.participantId === p.id).map((r) => roleLabel(r.role)),
      calls: usage.reduce((sum, u) => sum + u.calls, 0),
      failedCalls: usage.filter((u) => u.outcome !== "ok").reduce((sum, u) => sum + u.calls, 0),
      inputTokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
      outputTokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
      failureReason: p.failureReason,
    };
    return { id: p.id, provider: p.provider, model: p.modelId, state, details };
  });
  const completedPhases = phase ? COUNCIL_PHASES.indexOf(phase) + (live ? 0 : 1) : 0;
  // The Execution Council step follows the actual build run of an approved decision (#91).
  const featuredRun = featured?.status === "approved" ? (await listExecutions(db, actor, featured.id))[0] : undefined;
  const featuredBuild = featuredRun ? executionStates(await getExecutionView(db, actor, featuredRun.id)).build : null;
  const stepStates: Partial<Record<CouncilPhase, StepState>> = featured ? stepStatesFor(featured.currentPhase as CouncilPhase | null, featured.status) : {};
  if (featuredBuild) stepStates.execution_council = featuredBuild === "blocked" || featuredBuild === "cancelled" ? "pending" : featuredBuild;

  const firstProject = activeProjects[0];
  const next =
    awaiting[0] != null
      ? { href: `/sessions/${awaiting[0].id}`, icon: "doc" as const, title: awaiting[0].projectName, text: t("next.awaitingText"), action: t("next.awaitingAction") }
      : running[0] != null
        ? { href: `/sessions/${running[0].id}`, icon: "pulse" as const, title: running[0].projectName, text: t("next.runningText"), action: t("next.runningAction") }
        : credentials.length === 0 && can(actor.role, "credential:write")
          ? { href: "/settings/providers", icon: "key" as const, title: t("next.keysTitle"), text: t("next.keysText"), action: t("next.keysAction") }
          : sessions.length === 0 && firstProject
            ? { href: `/projects/${firstProject.id}`, icon: "play" as const, title: firstProject.name, text: t("next.firstText"), action: t("next.firstAction") }
            : { href: "/projects/new", icon: "plus" as const, title: t("next.startTitle"), text: t("next.startText"), action: t("next.startTitle") };
  const statusText = view ? statusOf(view.session.status).text : "";
  const phaseLine = view && phase ? (phase === "independent_thinking" && live ? t("submitted", { n: view.submittedCount, total: view.participants.length }) : t("phasesDone", { n: completedPhases })) : "";

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 md:mb-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[32px] leading-tight font-semibold tracking-tight md:text-[34px]">
            <span className="md:hidden">{t("titleMobile")}</span>
            <span className="max-md:hidden">{t("title")}</span>
          </h1>
          <p className="mt-1 text-muted md:text-[17px]">
            <span className="md:hidden">{t("introMobile")}</span>
            <span className="max-md:hidden">{t("intro")}</span>
          </p>
        </div>
        {can(actor.role, "project:write") ? (
          <Link href="/projects/new" className={buttonClasses("primary", "h-12 w-full rounded-xl px-5 text-base font-semibold shadow-[0_0_30px_-8px_var(--glow-cyan)] md:h-11 md:w-auto")}>
            <Icon name="plus" className="size-5" /> {t("next.startTitle")} <Icon name="arrow" className="size-4 md:hidden" />
          </Link>
        ) : null}
      </header>

      {/* Mobile shows the two most important numbers first; the other two follow below the next action. */}
      <section aria-label={t("metrics.label")} className="mb-5 grid grid-cols-2 gap-3 md:mb-6 md:gap-4 xl:grid-cols-4">
        <Metric href="/projects" icon="folder" label={t("metrics.projects")} value={activeProjects.length} tone="var(--primary)" />
        <Metric href="/decisions" icon="team" label={t("metrics.sessions")} value={sessions.length} tone="var(--accent)" className="max-md:hidden" />
        <Metric href={awaiting[0] ? `/sessions/${awaiting[0].id}` : "/decisions"} icon="clock" label={t("metrics.awaiting")} value={awaiting.length} tone="var(--warning)" />
        <Metric href={running[0] ? `/sessions/${running[0].id}` : "/decisions"} icon="pulse" label={t("metrics.running")} value={running.length} tone="var(--success)" className="max-md:hidden" />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        {/* Next action comes first in the DOM (mobile + reading order); desktop places it in the right column. */}
        <aside className="min-w-0 space-y-5 lg:col-start-2 lg:row-start-1" aria-label={t("asideLabel")}>
          <GlassPanel className="p-4 md:p-5">
            <PanelHeading title={t("nextAction")} />
            <NextAction {...next} />
          </GlassPanel>

          {view ? (
            <GlassPanel className="p-4 md:hidden" aria-label={t("liveCouncil")}>
              <LiveCouncilCompact
                href={`/sessions/${view.session.id}`}
                live={live}
                status={statusText}
                project={view.project.name}
                phase={phase ? COUNCIL_PHASE_LABELS[phase] : t("notStarted")}
                phaseLine={phaseLine}
                nodes={nodes}
                used={view.session.tokensUsed}
                budget={view.session.tokenBudget}
              />
            </GlassPanel>
          ) : null}

          <section aria-label={t("metrics.more")} className="grid grid-cols-2 gap-3 md:hidden">
            <Metric href="/decisions" icon="team" label={t("metrics.sessions")} value={sessions.length} tone="var(--accent)" />
            <Metric href={running[0] ? `/sessions/${running[0].id}` : "/decisions"} icon="pulse" label={t("metrics.running")} value={running.length} tone="var(--success)" />
          </section>

          <GlassPanel className="p-4 md:p-5">
            <PanelHeading title={t("providers.title")} href="/settings/providers">
              <Badge tone="accent">{t("providers.verified", { n: verified.length })}</Badge>
            </PanelHeading>
            {credentials.length === 0 ? (
              <p className="text-sm text-muted">{t("providers.none")}</p>
            ) : (
              <ul className="divide-y divide-glass-line">
                {credentials.map((c) => {
                  const state = !c.lastValidatedAt ? "unchecked" : c.lastValidationError ? "failed" : "verified";
                  const bars = state === "verified" ? 3 : state === "failed" ? 1 : 0;
                  return (
                    <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full border-[2.5px] shadow-[0_0_14px_-4px_currentColor]" style={{ borderColor: PROVIDER_COLOR[c.provider], color: PROVIDER_COLOR[c.provider] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {PROVIDER_NAME[c.provider] ?? c.provider} <span className="text-muted">· {c.label}</span>
                        </span>
                        <span className="block text-xs text-muted">{c.lastValidatedAt ? t("providers.checked", { when: relative(t, new Date(c.lastValidatedAt)) }) : t("providers.useCheck")}</span>
                      </span>
                      <span className={`text-xs ${state === "verified" ? "text-success" : state === "failed" ? "text-danger" : "text-muted"}`}>{t(`providers.state.${state}`)}</span>
                      <span aria-hidden="true" className="flex h-4 items-end gap-0.5">
                        {[1, 2, 3].map((n) => (
                          <span key={n} className={`w-1 rounded-sm ${n <= bars ? (bars === 3 ? "bg-success" : "bg-danger") : "bg-surface-2"}`} style={{ height: `${n * 5}px` }} />
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 flex items-center justify-between border-t border-glass-line pt-3 text-xs text-muted">
              {t("database.label")} <Badge tone={dbOk ? "success" : "danger"}>{dbOk ? t("database.ok") : t("database.down")}</Badge>
            </p>
          </GlassPanel>
        </aside>

        {view ? (
          <GlassPanel
            className={`min-w-0 border-[#22d3ee]/35 p-5 shadow-[0_0_40px_-18px_rgb(34_211_238/0.55)] max-md:hidden lg:col-start-1 lg:row-start-1 ${live ? "border-[#22d3ee]/60" : ""}`}
            aria-label={t("activityTitle")}
          >
            <PanelHeading title={t("activityTitle")}>
              {phase ? (
                <div className="flex items-center gap-3 text-right text-sm">
                  <span>
                    <span className={`flex items-center justify-end gap-1.5 font-medium ${live ? "text-primary" : "text-text"}`}>
                      <span aria-hidden="true" className={`size-2 rounded-full ${live ? "bg-primary [animation:consyrion-pulse_1.6s_ease-in-out_infinite]" : "bg-muted"}`} />
                      {COUNCIL_PHASE_LABELS[phase]}
                    </span>
                    <span className="text-xs text-muted">{phaseLine}</span>
                  </span>
                  <svg viewBox="0 0 36 36" className="size-11 -rotate-90" aria-hidden="true">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-2)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--primary)" strokeWidth="3" strokeDasharray={`${(completedPhases / 7) * 94.2} 94.2`} strokeLinecap="round" />
                  </svg>
                </div>
              ) : null}
            </PanelHeading>
            <p className="-mt-2 mb-3 text-sm text-muted md:text-[15px]">
              <Link href={`/sessions/${view.session.id}`} className="font-medium text-text hover:text-primary">
                {view.project.name}
              </Link>{" "}
              · {t("independentModels", { n: view.participants.length })}
            </p>
            <ActivityNetwork nodes={nodes} centerTitle={t("center")} centerSubtitle={statusText} />
            <p className="mt-2 text-center text-xs text-muted">{live ? t("liveNote") : t("latestNote")}</p>
          </GlassPanel>
        ) : (
          <EmptyCouncil next={next} />
        )}
      </div>

      {recent.length > 0 ? (
        <GlassPanel className="mt-5 p-4 md:p-5" aria-label={t("recent.title")}>
          <PanelHeading title={t("recent.title")} href="/decisions" />
          {/* Mobile: compact cards instead of a wide table. */}
          <ul className="space-y-2 md:hidden">
            {recent.slice(0, 3).map((s) => {
              const status = statusOf(s.status);
              return (
                <li key={s.id}>
                  <Link href={`/sessions/${s.id}`} className="flex items-center gap-3 rounded-xl border border-glass-line bg-surface/40 p-3 hover:border-primary/50">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
                      <Icon name="folder" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.projectName}</span>
                      <span className="block text-xs text-muted">
                        {s.currentPhase ? COUNCIL_PHASE_LABELS[s.currentPhase as CouncilPhase] : t("notStartedLower")} · {relative(t, s.createdAt)}
                      </span>
                    </span>
                    <Badge tone={status.tone}>{status.text}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="max-w-full overflow-x-auto max-md:hidden">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-glass-line">
                  <th className="py-2.5 pr-3 font-medium">{t("recent.topic")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("recent.providers")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("recent.stage")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("recent.status")}</th>
                  <th className="py-2.5 pr-3 font-medium">{t("recent.budget")}</th>
                  <th className="py-2.5 font-medium">{t("recent.updated")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-line">
                {recent.map((s) => {
                  const providers = participants.filter((p) => p.sessionId === s.id);
                  const share = s.tokenBudget ? Math.min(100, Math.round((s.tokensUsed / s.tokenBudget) * 100)) : 0;
                  const status = statusOf(s.status);
                  return (
                    <tr key={s.id}>
                      <td className="py-3 pr-3">
                        <Link href={`/sessions/${s.id}`} className="font-medium hover:text-primary">
                          {s.projectName}
                        </Link>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="flex gap-1.5" aria-label={providers.map((p) => `${PROVIDER_NAME[p.provider] ?? p.provider} ${p.modelId}`).join(", ")}>
                          {providers.map((p, i) => (
                            <span key={i} title={`${PROVIDER_NAME[p.provider] ?? p.provider} · ${p.modelId}`} className="size-4 rounded-full border-2 shadow-[0_0_8px_-2px_currentColor]" style={{ borderColor: PROVIDER_COLOR[p.provider], color: PROVIDER_COLOR[p.provider] }} />
                          ))}
                        </span>
                      </td>
                      <td className="py-3 pr-3">{s.currentPhase ? <Badge tone="accent">{COUNCIL_PHASE_LABELS[s.currentPhase as CouncilPhase]}</Badge> : <Badge>{t("notStartedLower")}</Badge>}</td>
                      <td className="py-3 pr-3">
                        <Badge tone={status.tone}>{status.text}</Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-2.5">
                          <span className="w-24 text-muted tabular-nums">
                            {compact(s.tokensUsed)} / {compact(s.tokenBudget)}
                          </span>
                          <span className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                            <span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--accent))] shadow-[0_0_10px_var(--glow-cyan)]" style={{ width: `${share}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className="py-3 text-muted">{relative(t, s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      ) : null}

      <GlassPanel className="mt-5 p-4 md:p-5">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold md:text-xl">{t("process")}</h2>
        <WorkflowStepper states={stepStates} label={t("processLabel")} />
      </GlassPanel>
    </>
  );
}
