import { independenceKey } from "@consyrium/core";
import type { SessionView } from "@consyrium/council";

/**
 * Full audit appendix (#268, level 3): every stored requirement check (requirement × proposal × actual evaluator) with
 * status and evidence – also checks that did not count – plus the model calls per model and phase. Read from the same
 * session view as the report; nothing is recomputed, nothing is shortened.
 */
export interface AuditCheck {
  requirement: string;
  proposal: string;
  evaluator: string;
  status: string;
  allPartsMet: boolean | null;
  evidence: string;
  estimate: string | null;
  counted: boolean;
  invalidReason: string | null;
}

export interface AuditUsage {
  model: string;
  phase: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DecisionAudit {
  checks: AuditCheck[];
  usage: AuditUsage[];
  versions: { brief: number | null; requirements: number | null; gate: number | null };
}

export function buildAudit(view: SessionView): DecisionAudit {
  const model = (participantId: string | null | undefined) => {
    const p = view.participants.find((x) => x.id === participantId);
    if (!p) return "unknown model";
    // User decision 08.11.26: instances of one model through other keys are named apart, one independent voice.
    const group = view.participants.filter((x) => independenceKey(x.provider, x.modelId) === independenceKey(p.provider, p.modelId));
    return group.length > 1 ? `${p.provider} · ${p.modelId} #${group.indexOf(p) + 1}/${group.length}` : `${p.provider} · ${p.modelId}`;
  };
  const items = view.requirementList?.items ?? [];
  const requirementName = (id: string) => {
    const index = items.findIndex((i) => i.id === id);
    return index >= 0 ? `R${index + 1} ${items[index]!.text}` : id;
  };
  const label = (proposalId: string) => view.proposals.find((p) => p.id === proposalId)?.label ?? "?";
  const order = (id: string) => {
    const index = items.findIndex((i) => i.id === id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const checks = [...(view.requirementChecks ?? [])]
    .sort((a, b) => order(a.requirementId) - order(b.requirementId) || label(a.proposalId).localeCompare(label(b.proposalId)))
    .map(
      (c): AuditCheck => ({
        requirement: requirementName(c.requirementId),
        proposal: label(c.proposalId),
        evaluator: model(c.evaluatorParticipantId),
        status: c.status,
        allPartsMet: c.allPartsMet ?? null,
        evidence: c.evidence,
        // Exactly as stored (#226): never rounded across a limit.
        estimate: c.estimateLow != null && c.estimateHigh != null ? `${c.estimateLow}–${c.estimateHigh}` : null,
        counted: c.valid,
        invalidReason: c.invalidReason ?? null,
      }),
    );
  const usage = new Map<string, AuditUsage>();
  // view.usage is already grouped per participant, phase and outcome.
  for (const u of view.usage ?? []) {
    const name = model(u.participantId);
    const key = `${name}/${u.phase ?? "other"}`;
    const row = usage.get(key) ?? { model: name, phase: u.phase ?? "other", calls: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
    row.calls += u.calls;
    if (u.outcome !== "ok") row.failed += u.calls;
    row.inputTokens += u.inputTokens;
    row.outputTokens += u.outputTokens;
    usage.set(key, row);
  }
  return {
    checks,
    usage: [...usage.values()].sort((a, b) => a.model.localeCompare(b.model) || a.phase.localeCompare(b.phase)),
    versions: {
      brief: (view as { brief?: { version?: number } | null }).brief?.version ?? null,
      requirements: view.requirementList?.version ?? null,
      gate: view.decisionStatus?.gateVersion ?? null,
    },
  };
}
