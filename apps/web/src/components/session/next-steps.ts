import { deriveCruxes } from "./cruxes";
import { contentOf, modelName, type View } from "./helpers";
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
  /** Objections still open or upheld against this proposal, with the model that raised them (#273 stage 1: source). */
  objections: Array<{ claim: string; severity: string; status: string; by: string }>;
  /**
   * #273 stage 1: the strongest substantiated counter-position against this proposal – the top open, unresolved or
   * upheld key dispute (#267 `deriveCruxes`), with its own reasoning as written. Null when there is none.
   */
  counter: { claim: string; by: string; evidence: string | null; status: string; severity: string } | null;
  /** The author's own assumptions, as written – the cheapest thing to test first. */
  assumptions: string[];
  /**
   * #273 stage 2: the author's own suggestion of the cheapest useful test, stop criteria and revisit triggers – as
   * written, empty fields dropped; null / empty when the proposal does not state them ("not stated").
   */
  cheapestTest: { assumption: string; method: string; successCriterion: string } | null;
  stopCriteria: string[];
  revisitTriggers: string[];
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
  // Gesamttest 08.11.26: a measurement check whose plan is confirmed (#249 part 2) is still open until a recorded
  // measurement of this verdict meets it – listed as "MEASURE", never as "nothing open".
  const byRequirement = new Map<string, boolean>();
  for (const m of (view as { measurements?: Array<{ decisionId: string; proposalId: string; requirementId: string; met: boolean }> }).measurements ?? [])
    if (m.decisionId === view.decision?.id && m.proposalId === proposal.id)
      byRequirement.set(m.requirementId, (byRequirement.get(m.requirementId) ?? true) && m.met); // one miss stays decisive
  const measured = new Set([...byRequirement].filter(([, met]) => met).map(([id]) => id));
  const verify = (g?.requirements ?? [])
    .filter((r) => r.status !== "PASS" || ((r as { measurementPending?: boolean }).measurementPending && !measured.has(r.requirementId)))
    .map((r) => {
      const index = items.findIndex((i) => i.id === r.requirementId);
      const status = r.status === "PASS" ? "MEASURE" : r.status;
      return { id: index >= 0 ? `R${index + 1}` : r.requirementId, text: index >= 0 ? items[index]!.text : "", status };
    });
  const objections = view.objections
    .filter((o) => o.proposalId === proposal.id && ["open", "accepted", "unresolved"].includes(o.status) && !(o as { moot?: unknown }).moot)
    .map((o) => ({
      claim: o.claim,
      severity: o.severity,
      status: o.status,
      by: modelName(view, (o as { raisedByParticipantId?: string }).raisedByParticipantId),
    }));
  // Same ranking as the Key disputes card (#267), not a second logic: blocking first, then status and severity.
  const top = deriveCruxes(view, proposal.id, 50).find(
    (c) => c.proposalId === proposal.id && (c.status === "open" || c.status === "unresolved" || c.status === "accepted") && !c.revision?.moot,
  );
  const counter = top ? { claim: top.claim.text, by: top.claim.by, evidence: top.claim.evidence, status: top.status, severity: top.severity } : null;
  const stopIf = (content.risks ?? [])
    .filter((r) => r.severity === "high" || r.severity === "critical")
    .map((r) => ({ risk: r.risk, mitigation: r.mitigation || null }));
  return {
    proposalId: proposal.id,
    verify,
    objections,
    counter,
    cheapestTest:
      content.cheapestTest && (content.cheapestTest.method?.trim() || content.cheapestTest.assumption?.trim())
        ? {
            assumption: content.cheapestTest.assumption?.trim() ?? "",
            method: content.cheapestTest.method?.trim() ?? "",
            successCriterion: content.cheapestTest.successCriterion?.trim() ?? "",
          }
        : null,
    stopCriteria: (content.stopCriteria ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
    revisitTriggers: (content.revisitTriggers ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
    assumptions: (content.assumptions ?? []).slice(0, 5),
    stopIf: stopIf.slice(0, 4),
    revisitWhen: ((view.consensus as { disagreements?: string[] } | null)?.disagreements ?? []).slice(0, 4),
  };
}
