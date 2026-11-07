import "server-only";
import { getExecutionView, listExecutions } from "@consyrion/build";
import { getSessionView } from "@consyrion/council";
import type { ActorContext, Database } from "@consyrion/db";
import type { ActivityNode } from "@/components/dashboard/activity-network-data";
import { mergeActivityNodes, sessionActivityNodes } from "@/lib/activity-nodes";

/**
 * Project overview (owner request 08.11.26): the council graphic of a project plus its key facts – only stored data.
 * `selection` is a session id, "all" (every model that ever took part, once) or empty (the newest session).
 */
export const OVERVIEW_SESSION_LIMIT = 12;

export interface OverviewSession {
  id: string;
  status: string;
  mode: string;
  tokensUsed: number;
  createdAt: Date;
}

export interface ProjectOverview {
  /** "all" or the id of the session the graphic shows; null when the project has no session. */
  selected: string | null;
  nodes: ActivityNode[];
  /** Status and verdict of the session the graphic shows (not for "all"). */
  shown: { id: string; status: string; outcome: string | null } | null;
  /** The newest session that reached a verdict. */
  lastDecision: { sessionId: string; status: string; outcome: string; createdAt: Date } | null;
  build: { sessionId: string; status: string; pullRequestUrl: string | null } | null;
  tokens: { council: number; build: number; total: number };
}

const DECIDED = new Set(["awaiting_approval", "approved", "rejected", "changes_requested"]);

export async function loadProjectOverview(db: Database, actor: ActorContext, sessions: OverviewSession[], selection?: string | null): Promise<ProjectOverview> {
  const council = sessions.reduce((sum, s) => sum + s.tokensUsed, 0);
  if (sessions.length === 0) return { selected: null, nodes: [], shown: null, lastDecision: null, build: null, tokens: { council: 0, build: 0, total: 0 } };

  const recent = sessions.slice(0, OVERVIEW_SESSION_LIMIT);
  const all = selection === "all";
  const chosen = all ? null : (sessions.find((s) => s.id === selection) ?? sessions[0]!);
  // Views are loaded once each: the shown session, the newest decided one, or – for "all" – the recent ones.
  const views = new Map<string, Awaited<ReturnType<typeof getSessionView>>>();
  const view = async (id: string) => {
    if (!views.has(id)) views.set(id, await getSessionView(db, actor, id));
    return views.get(id)!;
  };

  const nodes = all
    ? mergeActivityNodes(await Promise.all(recent.map(async (s) => sessionActivityNodes(await view(s.id)))))
    : sessionActivityNodes(await view(chosen!.id));
  const shownView = chosen ? await view(chosen.id) : null;

  const decided = sessions.find((s) => DECIDED.has(s.status));
  const decidedView = decided ? await view(decided.id) : null;
  const lastDecision =
    decided && decidedView?.decision
      ? { sessionId: decided.id, status: decided.status, outcome: decidedView.decision.outcome, createdAt: decided.createdAt }
      : null;

  // Builds run only for approved decisions; the newest run per session counts, at most the recent sessions.
  let build: ProjectOverview["build"] = null;
  let buildTokens = 0;
  for (const s of recent.filter((x) => x.status === "approved")) {
    for (const run of await listExecutions(db, actor, s.id)) {
      const execution = await getExecutionView(db, actor, run.id);
      buildTokens += execution.plan.tokensUsed;
      build ??= { sessionId: s.id, status: execution.plan.status, pullRequestUrl: execution.plan.pullRequestUrl };
    }
  }

  return {
    selected: all ? "all" : chosen!.id,
    nodes,
    shown: chosen && shownView ? { id: chosen.id, status: chosen.status, outcome: shownView.decision?.outcome ?? null } : null,
    lastDecision,
    build,
    tokens: { council, build: buildTokens, total: council + buildTokens },
  };
}
