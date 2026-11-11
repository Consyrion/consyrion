import type { ActivityNode } from "@/components/dashboard/activity-network-data";
import type { NodeState } from "@/components/dashboard/council-network";
import { roleLabel } from "@/components/session/helpers";

/**
 * Nodes of the "Council-Aktivität" graphic (models around the decision hexagon), shared by the dashboard and the
 * project overview (owner request 08.11.26: every project shows which AI took part). Only stored figures: the
 * session's participants, their role assignment and their usage records.
 */
export interface ActivitySessionView {
  session: { status: string; currentPhase: string | null };
  participants: ReadonlyArray<{ id: string; provider: string; modelId: string; status: string; failureReason: string | null }>;
  usage: ReadonlyArray<{ participantId: string | null; phase: string | null; outcome: string; calls: number; inputTokens: number; outputTokens: number }>;
  roles: ReadonlyArray<{ participantId: string; role: string }>;
}

const LIVE = new Set(["queued", "running", "cancel_requested"]);

/** One node per participant of a session, with its state in the current phase and its real call and token figures. */
export function sessionActivityNodes(view: ActivitySessionView): ActivityNode[] {
  const phase = view.session.currentPhase;
  const status = view.session.status;
  const live = LIVE.has(status);
  return view.participants.map((p) => {
    const answered = view.usage.some((u) => u.participantId === p.id && u.phase === phase && u.outcome === "ok");
    // Queued sessions have no request in flight yet; a council that ended without a verdict leaves unanswered models idle (#106).
    const state: NodeState =
      p.status === "failed"
        ? "failed"
        : status === "queued"
          ? "idle"
          : live
            ? answered
              ? "done"
              : "working"
            : status === "failed" || status === "cancelled"
              ? answered
                ? "done"
                : "idle"
              : "done";
    // #15/#41: answers to a human after the verdict are not part of the model's council activity.
    const usage = view.usage.filter((u) => u.participantId === p.id && (u as { kind?: string | null }).kind !== "intervention");
    return {
      id: p.id,
      provider: p.provider,
      model: p.modelId,
      state,
      details: {
        roles: view.roles.filter((r) => r.participantId === p.id).map((r) => roleLabel(r.role)),
        calls: usage.reduce((sum, u) => sum + u.calls, 0),
        failedCalls: usage.filter((u) => u.outcome !== "ok").reduce((sum, u) => sum + u.calls, 0),
        inputTokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
        outputTokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
        failureReason: p.failureReason,
      },
    };
  });
}

/**
 * "All sessions" of a project: every model that ever took part, once (provider + model id), with the number of sessions,
 * calls and tokens summed. A model counts as failed only when it failed in every session it joined.
 */
export function mergeActivityNodes(sessions: ReadonlyArray<ReadonlyArray<ActivityNode>>): ActivityNode[] {
  const merged = new Map<string, ActivityNode & { failedIn: number }>();
  for (const nodes of sessions) {
    for (const node of nodes) {
      const key = `${node.provider}:${node.model.toLowerCase()}`;
      const d = node.details;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, {
          id: key,
          provider: node.provider,
          model: node.model,
          state: node.state,
          failedIn: node.state === "failed" ? 1 : 0,
          details: {
            roles: [...(d?.roles ?? [])],
            calls: d?.calls ?? 0,
            failedCalls: d?.failedCalls ?? 0,
            inputTokens: d?.inputTokens ?? 0,
            outputTokens: d?.outputTokens ?? 0,
            failureReason: null,
            sessions: 1,
          },
        });
        continue;
      }
      const cd = current.details!;
      cd.roles = [...new Set([...cd.roles, ...(d?.roles ?? [])])];
      cd.calls += d?.calls ?? 0;
      cd.failedCalls += d?.failedCalls ?? 0;
      cd.inputTokens += d?.inputTokens ?? 0;
      cd.outputTokens += d?.outputTokens ?? 0;
      cd.sessions = (cd.sessions ?? 1) + 1;
      if (node.state === "failed") current.failedIn += 1;
      // A live session anywhere keeps the model "working"; otherwise finished.
      if (node.state === "working") current.state = "working";
    }
  }
  return [...merged.values()].map(({ failedIn, ...node }) => ({
    ...node,
    state: failedIn === node.details!.sessions ? "failed" : node.state === "working" ? "working" : "done",
  }));
}
