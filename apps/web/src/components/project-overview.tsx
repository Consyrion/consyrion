import { DECISION_MODE_LABELS } from "@consyrium/core";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ProjectOverview as Overview, OverviewSession } from "@/lib/server/project-overview";
import { ActivityNetwork } from "./dashboard/activity-network";
import { EmptyCouncil } from "./dashboard/empty-council";
import { ProjectOverviewPicker } from "./project-overview-picker";
import { GlassPanel } from "./ui/glass";
import { Badge } from "./ui/surface";

/**
 * Project overview (owner request 08.11.26): which AI models took part in this project's councils – the dashboard's
 * council graphic – next to the project's key facts. Everything shown comes from stored data.
 */
export async function ProjectOverview({
  project,
  overview,
  sessions,
  requirementList,
  canRun,
  archived = false,
}: {
  project: { id: string; status: string; repositoryFullName: string | null; createdAt: Date; updatedAt: Date };
  overview: Overview;
  sessions: OverviewSession[];
  requirementList: { version: number; items: unknown[] } | null;
  canRun: boolean;
  /** #548: archived projects explain why no council can start and point to the restore card. */
  archived?: boolean;
}) {
  const t = await getTranslations("projects.overview");
  const tProject = await getTranslations("projects");
  const tStatus = await getTranslations("decisions.status");
  // A build run has its own states (executionScreen.status.plan): "completed" was shown raw (live check 08.11.26).
  const tPlan = await getTranslations("executionScreen.status.plan");
  const tOutcome = await getTranslations("verdict.dashboard.outcome");
  const tWorkspace = await getTranslations("sessionWorkspace");
  const format = await getFormatter();
  const status = (s: string) => (tStatus.has(s) ? tStatus(s) : s.replaceAll("_", " "));
  const outcome = (o: string) => (tOutcome.has(o) ? tOutcome(o) : o.replaceAll("_", " "));
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  if (sessions.length === 0)
    return (
      <div className="mb-6">
        <EmptyCouncil
          next={{
            href: archived ? "#project-archive" : `/projects/${project.id}/council/new`,
            icon: "play",
            title: t("emptyTitle"),
            text: t("emptyText"),
            action: archived ? tProject("archive.startBlocked") : canRun ? tProject("startCouncil") : t("emptyNoRights"),
          }}
        />
      </div>
    );

  const options = [
    ...sessions.map((s, i) => ({
      value: s.id,
      label: `${i === 0 ? `${t("latest")} · ` : ""}${DECISION_MODE_LABELS[s.mode as keyof typeof DECISION_MODE_LABELS] ?? s.mode} · ${format.dateTime(s.createdAt, { dateStyle: "short", timeStyle: "short" })}`,
    })),
    ...(sessions.length > 1 ? [{ value: "all", label: t("allSessions", { n: Math.min(sessions.length, 12) }) }] : []),
  ];
  const facts: Array<[string, React.ReactNode]> = [
    [t("status"), <Badge key="s">{tProject.has(`status.${project.status}`) ? tProject(`status.${project.status}`) : project.status}</Badge>],
    [t("sessions"), String(sessions.length)],
    [
      t("lastDecision"),
      overview.lastDecision ? (
        <Link key="d" href={`/sessions/${overview.lastDecision.sessionId}`} className="text-primary hover:underline">
          {outcome(overview.lastDecision.outcome)}
        </Link>
      ) : (
        <span key="d" className="text-muted">
          {t("none")}
        </span>
      ),
    ],
    [
      t("approval"),
      overview.lastDecision ? (
        // #477 / #268: the same split as the session header.
        overview.lastDecision.awaitingReview ? (
          `${tWorkspace("status.awaitingReview")} · ${tWorkspace("status.noApprovableProposal")}`
        ) : (
          status(overview.lastDecision.status)
        )
      ) : (
        <span className="text-muted">{t("none")}</span>
      ),
    ],
    [
      t("build"),
      overview.build ? (
        <span key="b" className="flex flex-wrap items-center gap-2">
          {tPlan.has(overview.build.status) ? tPlan(overview.build.status) : overview.build.status.replaceAll("_", " ")}
          {overview.build.pullRequestUrl ? (
            <a href={overview.build.pullRequestUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {t("draftPr")}
            </a>
          ) : null}
        </span>
      ) : (
        <span key="b" className="text-muted">
          {t("none")}
        </span>
      ),
    ],
    [
      t("repository"),
      project.repositoryFullName ? (
        <a
          key="r"
          href={`https://github.com/${project.repositoryFullName}`}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary hover:underline"
        >
          {project.repositoryFullName}
        </a>
      ) : (
        <span key="r" className="text-muted">
          {t("none")}
        </span>
      ),
    ],
    [
      t("requirements"),
      requirementList ? (
        tProject("listVersion", { version: requirementList.version, n: requirementList.items.length })
      ) : (
        <span className="text-muted">{t("none")}</span>
      ),
    ],
    [
      t("tokens"),
      t("tokensValue", {
        total: format.number(overview.tokens.total),
        council: format.number(overview.tokens.council),
        build: format.number(overview.tokens.build),
      }),
    ],
    [t("created"), date(project.createdAt)],
    [t("updated"), date(project.updatedAt)],
  ];

  return (
    <GlassPanel className="mb-6 min-w-0 p-4 md:p-5" aria-label={t("title")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">{t("title")}</h2>
        {options.length > 1 ? <ProjectOverviewPicker value={overview.selected ?? sessions[0]!.id} options={options} label={t("pick")} /> : null}
      </div>
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <ActivityNetwork
            nodes={overview.nodes}
            centerTitle={t("center")}
            centerSubtitle={overview.shown ? (overview.shown.outcome ? outcome(overview.shown.outcome) : status(overview.shown.status)) : t("allSessionsShort")}
          />
          <p className="mt-2 text-center text-xs text-muted">
            {overview.shown ? (
              <Link href={`/sessions/${overview.shown.id}`} className="hover:text-primary">
                {t("models", { n: overview.nodes.length })} · {t("openSession")}
              </Link>
            ) : (
              t("allNote", { n: overview.nodes.length })
            )}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2.5 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </GlassPanel>
  );
}
