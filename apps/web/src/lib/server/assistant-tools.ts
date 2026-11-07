import "server-only";
import { listExecutions } from "@consyrion/build";
import { getSessionView, listSessions } from "@consyrion/council";
import { listProjects, type ActorContext, type Database } from "@consyrion/db";
import type { AssistantTool } from "./assistant";

/**
 * Read-only tools of the assistant (#282). Each one calls the same repository functions as the app pages, with the
 * signed-in user's actor – so the assistant sees exactly what the user may see, nothing from other workspaces, and
 * cannot change anything. Results are compact on purpose (tokens on the user's key).
 */
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
        return {
          data: {
            project: view.project.name,
            status: view.session.status,
            phase: view.session.currentPhase,
            tokens: `${view.session.tokensUsed}/${view.session.tokenBudget}`,
            mode: view.session.mode,
            verdict: view.decision
              ? {
                  outcome: view.decision.outcome,
                  recommended: label(view.decision.recommendedProposalId),
                  approvable: view.decisionStatus?.approvable ?? null,
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
  ];
}
