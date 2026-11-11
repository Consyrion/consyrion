import type { GateRequirement } from "./requirement-gate";

/**
 * The status a reader sees for one requirement × proposal (#266): one derivation for the heatmap cell, its detail panel
 * and the requirement table of the Evaluation tab, so they never disagree. A confirmed build or measurement plan is
 * not "met" – the proof comes from the build or the measurement. Words: `verdict.dashboard.req.<key>`.
 */
export type RequirementCellKey = "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN" | "PLAN" | "MEASURE";

export function requirementCellKey(req: Pick<GateRequirement, "status" | "buildVerification" | "measurementPending"> | undefined): RequirementCellKey {
  if (!req) return "UNKNOWN";
  if (req.status === "PASS" && req.buildVerification) return "PLAN";
  if (req.status === "PASS" && req.measurementPending) return "MEASURE";
  return req.status;
}

/**
 * Symbol and style per status. Word and symbol carry the meaning (print, colour blindness, both themes); colour only
 * supports it. DISPUTED (evaluators contradict each other) is set apart from UNKNOWN (nobody could confirm): its own
 * symbol, a dashed red frame and its own word.
 */
export const REQUIREMENT_CELL: Record<RequirementCellKey, { icon: string; tone: "success" | "warning" | "danger"; className: string }> = {
  PASS: { icon: "✓", tone: "success", className: "border-success/50 bg-success/10 text-success" },
  FAIL: { icon: "✕", tone: "danger", className: "border-danger/60 bg-danger/15 text-danger" },
  DISPUTED: { icon: "≠", tone: "danger", className: "border-dashed border-danger/70 bg-surface text-danger" },
  UNKNOWN: { icon: "?", tone: "warning", className: "border-warning/50 bg-warning/10 text-warning" },
  PLAN: { icon: "◷", tone: "warning", className: "border-dotted border-warning/60 bg-surface text-warning" },
  MEASURE: { icon: "◷", tone: "warning", className: "border-dotted border-warning/60 bg-surface text-warning" },
};

/**
 * Rows of the heatmap after the search and the "problems only" filter (#266 part B): a problem is any status other than
 * met for at least one proposal. Pure, so the filter is tested apart from the screen.
 */
export function filterRequirementRows<R extends { id: string; short: string; text: string }>(
  rows: readonly R[],
  gate: { proposals: ReadonlyArray<{ requirements: ReadonlyArray<GateRequirement> }> } | undefined,
  filter: { query: string; onlyProblems: boolean },
): R[] {
  const needle = filter.query.trim().toLowerCase();
  const isProblem = (id: string) => (gate?.proposals ?? []).some((g) => requirementCellKey(g.requirements.find((x) => x.requirementId === id)) !== "PASS");
  return rows.filter((r) => (!filter.onlyProblems || isProblem(r.id)) && (!needle || `${r.short} ${r.text}`.toLowerCase().includes(needle)));
}
