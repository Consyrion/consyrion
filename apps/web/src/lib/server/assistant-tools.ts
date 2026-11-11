import { reportStatus } from "./report-status";
import "server-only";
import { getExecutionView, listExecutions } from "@consyrium/build";
import { getSessionView, listSessions } from "@consyrium/council";
import { getProject, latestRequirementList, listDocuments, listProjects, requirementSourceState, type ActorContext, type Database } from "@consyrium/db";
import type { AssistantTool } from "./assistant";

/**
 * Read-only tools of the assistant (#282). Each one calls the same repository functions as the app pages, with the
 * signed-in user's actor – so the assistant sees exactly what the user may see, nothing from other workspaces, and
 * cannot change anything. Results are compact on purpose (tokens on the user's key).
 */

/**
 * Windows smoke test 08.11.26: `decisionStatus.approvable` only says the outcome type allows an approval at all
 * (no_qualifying_solution does, for an alternative). MCP and assistant clients read "something can be approved now":
 * false when no proposal passes, as the web UI says ("Kein Vorschlag kann freigegeben werden").
 */
export function approvableNow(status: { approvable: boolean; canApproveRecommendation: boolean; approvableProposalIds: string[] }): boolean {
  return status.approvable && (status.canApproveRecommendation || status.approvableProposalIds.length > 0);
}

const str = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
};
const clip = (value: string | null | undefined, max: number) => (value ? (value.length > max ? `${value.slice(0, max)}…` : value) : null);

export function assistantTools(db: Database, actor: ActorContext): AssistantTool[] {
  const sessionLink = (s: { id: string; projectName?: string | null }) => ({ label: s.projectName ?? s.id, href: `/sessions/${s.id}` });
  return [
    {
      name: "list_projects",
      description: "All projects of this workspace with id, name, type and status.",
      args: "{}",
      async run() {
        const rows = await listProjects(db, actor);
        return {
          data: {
            total: rows.length,
            shown: Math.min(rows.length, 50),
            projects: rows.slice(0, 50).map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, href: `/projects/${p.id}` })),
          },
          links: rows.slice(0, 20).map((p) => ({ label: p.name, href: `/projects/${p.id}` })),
        };
      },
    },
    {
      name: "list_sessions",
      description:
        "Council sessions (decisions), newest first. Optional status filter: queued, running, awaiting_approval, approved, rejected, failed, cancelled. Optional projectId.",
      args: "{ status?: string, projectId?: string }",
      async run(args) {
        const status = typeof args.status === "string" ? args.status : null;
        const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
        const all = (await listSessions(db, actor, projectId)).filter((s) => !status || s.status === status);
        const rows = all.slice(0, 30);
        return {
          data: {
            total: all.length,
            shown: rows.length,
            sessions: rows.map((s) => ({
              id: s.id,
              project: s.projectName,
              status: s.status,
              phase: s.currentPhase,
              tokens: `${s.tokensUsed}/${s.tokenBudget}`,
              created: new Date(s.createdAt).toISOString().slice(0, 10),
              href: `/sessions/${s.id}`,
            })),
          },
          links: rows.map(sessionLink),
        };
      },
    },
    {
      name: "get_session",
      description:
        "One decision in detail: status, the council's verdict and whether it can be approved (with the server's reason), proposals with scores, open objections, the human decision. Use for summaries, also for a customer.",
      args: "{ sessionId: string }",
      async run(args) {
        if (typeof args.sessionId !== "string") throw new Error("sessionId required");
        const view = await getSessionView(db, actor, args.sessionId);
        const label = (id: string | null | undefined) => view.proposals.find((p) => p.id === id)?.label ?? null;
        const matrix = view.decision?.matrix as { proposals?: Array<{ proposalId: string; total: number | null }> } | undefined;
        const content = (p: (typeof view.proposals)[number]) => (p.revisions.at(-1)?.content ?? {}) as { title?: string; summary?: string };
        const last = view.approvals.at(-1);
        // Gesamttest 0d, finding 10: the assistant must know what the screen knows – the readable status (same
        // derivation as the verdict screen and the PDF), a favourite or prototype build, open measurements, next steps,
        // and that an archived project is read-only. Worded in English; the model answers in the user's language.
        const status = reportStatus(view, "en");
        const archived = (view.project as { status?: string }).status === "archived";
        return {
          data: {
            project: view.project.name,
            projectArchived: archived,
            ...(archived
              ? {
                  archivedNote:
                    "The project is archived and read-only: no decision, no new council and no build are possible until someone restores it on the projects page.",
                }
              : {}),
            statusText: [status.title, status.line].filter(Boolean).join(" – "),
            humanMarks: status.marks ?? [],
            openMeasurements: status.measurements ? status.measurements.lines.slice(0, 8) : [],
            nextSteps: archived ? [] : (status.nextSteps?.lines.slice(0, 6) ?? []),
            status: view.session.status,
            phase: view.session.currentPhase,
            tokens: `${view.session.tokensUsed}/${view.session.tokenBudget}`,
            mode: view.session.mode,
            // #363 part 3: the skill this council was set up with, pinned by version and content hash.
            skill: view.session.skill
              ? {
                  id: view.session.skill.skillId,
                  name: view.session.skill.name,
                  version: view.session.skill.version,
                  contentHash: view.session.skill.contentHash,
                }
              : null,
            verdict: view.decision
              ? {
                  outcome: view.decision.outcome,
                  recommended: label(view.decision.recommendedProposalId),
                  // Windows smoke test 08.11.26: `decisionStatus.approvable` only says the outcome type allows an
                  // approval at all (no_qualifying_solution does, for an alternative). A client must read "something
                  // can be approved now" – false when no proposal passes, as the web UI says.
                  approvable: view.decisionStatus ? approvableNow(view.decisionStatus) : null,
                  approvableProposals: (view.decisionStatus?.approvableProposalIds ?? []).map(label),
                  reason: view.decisionStatus?.reason ?? null,
                }
              : null,
            proposals: view.proposals.map((p) => ({
              label: p.label,
              title: content(p).title ?? null,
              summary: (content(p).summary ?? "").slice(0, 400),
              score: matrix?.proposals?.find((m) => m.proposalId === p.id)?.total ?? null,
            })),
            openObjections: view.objections
              .filter((o) => ["open", "accepted", "unresolved"].includes(o.status))
              .slice(0, 6)
              .map((o) => ({ proposal: label(o.proposalId), severity: o.severity, status: o.status, claim: o.claim.slice(0, 300) })),
            humanDecision: last ? { action: last.action, chosen: label(last.selectedProposalId), comment: last.comment || null } : null,
            href: `/sessions/${view.session.id}`,
          },
          links: [{ label: view.project.name, href: `/sessions/${view.session.id}` }],
        };
      },
    },
    {
      name: "list_open_steps",
      description:
        "What is waiting across the workspace: decisions awaiting the human approval, failed or running councils, and builds of approved decisions that failed, are running or finished without a pull request.",
      args: "{}",
      async run() {
        const sessions = await listSessions(db, actor);
        const steps: Array<{ kind: string; project: string; status: string; href: string }> = [];
        for (const s of sessions) {
          // An archived project waits for nobody (Gesamttest 08.11.26) – its sessions are no open step.
          if (s.projectStatus === "archived") continue;
          if (["awaiting_approval", "failed", "running", "queued"].includes(s.status)) {
            steps.push({
              kind: s.status === "awaiting_approval" ? "decision_waiting_for_you" : `council_${s.status}`,
              project: s.projectName,
              status: s.status,
              href: `/sessions/${s.id}`,
            });
          } else if (s.status === "approved") {
            const [latest] = await listExecutions(db, actor, s.id);
            if (!latest) steps.push({ kind: "approved_not_built", project: s.projectName, status: "approved", href: `/sessions/${s.id}` });
            else if (latest.status !== "completed" && latest.status !== "cancelled")
              steps.push({ kind: `build_${latest.status}`, project: s.projectName, status: latest.status, href: `/sessions/${s.id}` });
          }
        }
        return {
          data: { total: steps.length, shown: Math.min(steps.length, 30), steps: steps.slice(0, 30) },
          links: steps.slice(0, 15).map((st) => ({ label: st.project, href: st.href })),
        };
      },
    },
    {
      name: "get_project",
      description:
        "One project: brief (idea, goal, requirements – shortened), whether its requirement list is confirmed and current (a council can only start on a current list), its documents and its councils.",
      args: "{ projectId: string }",
      async run(args) {
        const project = await getProject(db, actor, str(args.projectId, "projectId"));
        const [list, source, documents, sessions] = await Promise.all([
          latestRequirementList(db, actor, project.id),
          requirementSourceState(db, actor, project.id).catch(() => null),
          listDocuments(db, actor, project.id),
          listSessions(db, actor, project.id),
        ]);
        return {
          data: {
            id: project.id,
            name: project.name,
            type: project.type,
            status: project.status,
            repository: project.repositoryFullName ?? null,
            brief: project.brief
              ? {
                  version: project.brief.version,
                  idea: clip(project.brief.idea, 1200),
                  goal: clip(project.brief.goal, 400),
                  requirements: clip(project.brief.requirements, 1200),
                }
              : null,
            requirementList: list
              ? {
                  version: list.version,
                  items: list.items.length,
                  noHardRequirements: list.noHardRequirements,
                  current: Boolean(source && list.sourceHash === source.hash),
                  // Live test 08.11.26: "version + current" alone left the model unsure whether the list was confirmed.
                  confirmed: true,
                  councilCanStart: Boolean(source && list.sourceHash === source.hash),
                }
              : { version: null, items: 0, current: false, confirmed: false, councilCanStart: false, note: "not confirmed yet" },
            documents: documents.map((d) => ({ name: d.name, role: d.role, sizeBytes: d.sizeBytes })),
            councils: sessions
              .slice(0, 10)
              .map((s) => ({ id: s.id, status: s.status, created: new Date(s.createdAt).toISOString().slice(0, 10), href: `/sessions/${s.id}` })),
            href: `/projects/${project.id}`,
          },
          links: [{ label: project.name, href: `/projects/${project.id}` }, ...sessions.slice(0, 5).map(sessionLink)],
        };
      },
    },
    {
      name: "list_documents",
      description:
        "Documents attached to one project: name, size, whether it is a source of requirements or only context, and for images the description state.",
      args: "{ projectId: string }",
      async run(args) {
        const projectId = str(args.projectId, "projectId");
        const project = await getProject(db, actor, projectId);
        const documents = await listDocuments(db, actor, projectId);
        return {
          data: {
            project: project.name,
            total: documents.length,
            documents: documents.map((d) => ({
              name: d.name,
              sizeBytes: d.sizeBytes,
              role: d.role === "context" ? "context (read by the models, never a source of requirements)" : "source of requirements",
              origin: d.origin?.kind ?? "upload",
              image: d.descriptionStatus ? { descriptionStatus: d.descriptionStatus } : null,
              added: new Date(d.createdAt).toISOString().slice(0, 10),
            })),
            href: `/projects/${projectId}`,
          },
          links: [{ label: project.name, href: `/projects/${projectId}` }],
        };
      },
    },
    {
      name: "get_build_status",
      description:
        "The latest build (Execution Council) of an approved decision: status, tasks done, test runs, reviews, whether a draft pull request may be opened (with the blocking reasons) and the pull request link.",
      args: "{ sessionId: string }",
      async run(args) {
        const sessionId = str(args.sessionId, "sessionId");
        const [latest] = await listExecutions(db, actor, sessionId);
        if (!latest)
          return {
            data: { sessionId, build: null, note: "No build was started for this decision." },
            links: [{ label: "Decision", href: `/sessions/${sessionId}` }],
          };
        const view = await getExecutionView(db, actor, latest.id);
        const lastTest = view.tests.at(-1);
        return {
          data: {
            sessionId,
            status: view.plan.status,
            tasks: { total: view.tasks.length, done: view.tasks.filter((t) => t.status === "done").length },
            changedFiles: view.files.filter((f) => f.changed).length,
            latestTest: lastTest ? { kind: lastTest.kind, status: lastTest.status } : null,
            reviews: view.reviews.map((r) => ({ focus: r.focus, verdict: r.verdict })),
            pullRequest: {
              url: view.plan.pullRequestUrl ?? null,
              blocked: view.readiness.blocked,
              reasons: view.readiness.reasons,
              warnings: view.readiness.warnings,
            },
            tokens: view.usage.tokens,
            href: `/sessions/${sessionId}`,
          },
          links: [{ label: "Build", href: `/sessions/${sessionId}` }],
        };
      },
    },
    {
      name: "search",
      description:
        "Finds projects and decisions whose name, idea, goal or requirements contain the words of the query (case-insensitive). Use it before asking the user for an id.",
      args: "{ query: string }",
      async run(args) {
        const words = str(args.query, "query").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
        const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
        const projects = await listProjects(db, actor);
        const briefs = await Promise.all(
          projects.slice(0, 100).map((p) =>
            getProject(db, actor, p.id)
              .then((full) => full.brief)
              .catch(() => null),
          ),
        );
        const foundProjects = projects
          .slice(0, 100)
          .filter((p, i) => matches([p.name, briefs[i]?.idea, briefs[i]?.goal, briefs[i]?.requirements].filter(Boolean).join("\n")))
          .slice(0, 15);
        const ids = new Set(foundProjects.map((p) => p.id));
        const sessions = (await listSessions(db, actor)).filter((s) => ids.has(s.projectId) || matches(s.projectName ?? "")).slice(0, 15);
        return {
          data: {
            query: words.join(" "),
            projects: foundProjects.map((p) => ({ id: p.id, name: p.name, status: p.status, href: `/projects/${p.id}` })),
            decisions: sessions.map((s) => ({ id: s.id, project: s.projectName, status: s.status, href: `/sessions/${s.id}` })),
          },
          links: [...foundProjects.slice(0, 8).map((p) => ({ label: p.name, href: `/projects/${p.id}` })), ...sessions.slice(0, 7).map(sessionLink)],
        };
      },
    },
  ];
}
