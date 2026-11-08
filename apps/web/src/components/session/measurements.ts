import type { View } from "./helpers";
import type { RequirementGateResult } from "./requirement-gate";

/**
 * Acceptance by measurement (#249 gate 2), one derivation for the measurement panel and the PDF (#268): per
 * architecture candidate the requirements whose measurement is open, with every recorded result of this verdict.
 * One measured miss stays decisive – the server applies the same rule; this only displays it.
 */
export type MeasurementState = "open" | "met" | "notMet";
export type MeasurementResult = NonNullable<View["measurements"]>[number];

export interface MeasurementRow {
  proposalId: string;
  requirements: Array<{ requirementId: string; text: string; state: MeasurementState; own: MeasurementResult[] }>;
}

export function measurementRows(view: View, gate: RequirementGateResult | undefined): MeasurementRow[] {
  if (!gate) return [];
  const items = new Map((view.requirementList?.items ?? []).map((i) => [i.id, i.text]));
  const results = (view.measurements ?? []).filter((m) => m.decisionId === view.decision?.id);
  return gate.proposals
    .filter((p) => p.architectureCandidate && p.requirements.some((r) => r.measurementPending))
    .map((p) => ({
      proposalId: p.proposalId,
      requirements: p.requirements
        .filter((r) => r.measurementPending)
        .map((r) => {
          const own = results.filter((m) => m.proposalId === p.proposalId && m.requirementId === r.requirementId);
          const state: MeasurementState = own.some((m) => !m.met) ? "notMet" : own.length ? "met" : "open";
          return { requirementId: r.requirementId, text: items.get(r.requirementId) ?? "", state, own };
        }),
    }));
}
