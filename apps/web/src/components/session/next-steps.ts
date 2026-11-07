import { contentOf, type View } from "./helpers";
import type { RequirementGateResult } from "./requirement-gate";

/**
 * What to do next (#273, MVP): built only from stored council data for one proposal – the recommendation, or when
 * there is none the best-scored one – so nothing is generated and nothing is invented. Each item names its source.
 * A measurement or test idea stays a plan; it never turns an unconfirmed requirement into a met one.
 */
export interface NextSteps {
  proposalId: string;
  /** Requirements not confirmed for this proposal (FAIL/UNKNOWN/DISPUTED) – to settle before any irreversible step. */
  verify: Array<{ id: string; text: string; status: string }>;
  /** Objections still open or upheld against this proposal. */
  objections: Array<{ claim: string; severity: string; status: string }>;
  /** The author's own assumptions, as written – the cheapest thing to test first. */
  assumptions: string[];
  /** High/critical risks with the author's mitigation: if one materialises, stop and re-check. */
  stopIf: Array<{ risk: string; mitigation: string | null }>;
  /** Points the Consensus Round left open: new facts on them justify a new council. */
  revisitWhen: string[];
}

export function deriveNextSteps(view: View, proposalId: string | null, gate?: RequirementGateResult): NextSteps | null {
  const proposal = view.proposals.find((p) => p.id === proposalId);
  if (!proposal) return null;
  const content = contentOf(proposal);
  const items = view.requirementList?.items ?? [];
  const g = gate?.proposals.find((x) => x.proposalId === proposal.id);
  const verify = (g?.requirements ?? [])
    .filter((r) => r.status !== "PASS")
    .map((r) => {
      const index = items.findIndex((i) => i.id === r.requirementId);
      return { id: index >= 0 ? `R${index + 1}` : r.requirementId, text: index >= 0 ? items[index]!.text : "", status: r.status };
    });
  const objections = view.objections
    .filter((o) => o.proposalId === proposal.id && ["open", "accepted", "unresolved"].includes(o.status) && !(o as { moot?: unknown }).moot)
    .map((o) => ({ claim: o.claim, severity: o.severity, status: o.status }));
  const stopIf = (content.risks ?? [])
    .filter((r) => r.severity === "high" || r.severity === "critical")
    .map((r) => ({ risk: r.risk, mitigation: r.mitigation || null }));
  return {
    proposalId: proposal.id,
    verify,
    objections,
    assumptions: (content.assumptions ?? []).slice(0, 5),
    stopIf: stopIf.slice(0, 4),
    revisitWhen: ((view.consensus as { disagreements?: string[] } | null)?.disagreements ?? []).slice(0, 4),
  };
}
