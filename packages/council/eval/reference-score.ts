/**
 * Scores stored Decision Reports against the #182 reference set. Offline and deterministic: it reads only the report
 * JSON (outcome, approvability, conflict flag, tokens) – no provider call, no database. Main measure is the share of
 * correct verdicts, with false approvals (safety) and unnecessary blocks counted apart, never the recommendation rate.
 */
import type { DecisionReport } from "../src/report";
import { REFERENCE_CASES, type ReferenceCase, type VerdictClass } from "./reference-cases";

/** The report fields the scorer reads; a stored report JSON is enough. */
export type ScoredReport = Pick<DecisionReport, "outcome" | "requirementsConflict" | "tokens"> & {
  decisionFormat: { approvable: boolean } | null;
  /** Gate version 3 (#249 part 2): an architecture candidate is named per proposal; absent in older reports. */
  requirementGate?: { proposals: Array<{ feasibility: string }> } | null;
};

const ARCHITECTURE_CANDIDATE = "architecture candidate (performance proof open)";

export function classifyReport(report: ScoredReport): VerdictClass {
  if (!report.outcome) return "no_verdict";
  if (report.requirementsConflict) return "requirements_conflict";
  // A recommendation the server will not let anyone approve (limited review #249, unknown format) is not one.
  if (report.outcome === "recommended") return report.decisionFormat?.approvable === false ? "needs_verification" : "recommended";
  // #249 part 2: no recommendation, but a proposal passed every check up to a measurement still open.
  if (report.outcome === "needs_verification" && report.requirementGate?.proposals.some((p) => p.feasibility === ARCHITECTURE_CANDIDATE))
    return "architecture_candidate";
  return report.outcome as VerdictClass;
}

export type RunResult = "correct" | "false_approval" | "unnecessary_block" | "wrong" | "failed_run";

export function scoreRun(reference: ReferenceCase, report: ScoredReport): { verdict: VerdictClass; result: RunResult } {
  const verdict = classifyReport(report);
  if (verdict === "no_verdict") return { verdict, result: "failed_run" };
  const solvable = reference.correct.includes("recommended");
  // A tie between qualified proposals leaves a valid choice to the human – correct wherever a recommendation is.
  if (reference.correct.includes(verdict) || (solvable && verdict === "tie")) return { verdict, result: "correct" };
  if (verdict === "recommended") return { verdict, result: "false_approval" };
  return { verdict, result: solvable ? "unnecessary_block" : "wrong" };
}

export interface ScoredRun {
  caseId: string;
  config: string;
  file: string;
  report: ScoredReport;
}

export interface ConfigSummary {
  config: string;
  runs: number;
  /** Runs whose case has a human-reviewed label; every rate below uses only these. */
  reviewedRuns: number;
  correct: number;
  falseApprovals: number;
  /** Runs on cases where a recommendation is not correct – the denominator of the false approval rate. */
  notSolvableRuns: number;
  unnecessaryBlocks: number;
  solvableRuns: number;
  failedRuns: number;
  tokens: number;
  /** Tokens per correct verdict; a correct rejection counts as useful (external review 30.10.26). */
  tokensPerCorrect: number | null;
  rows: Array<{ caseId: string; file: string; reviewed: boolean; verdict: VerdictClass; result: RunResult; tokens: number }>;
}

export function summarize(runs: ScoredRun[], cases: ReferenceCase[] = REFERENCE_CASES): ConfigSummary[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const configs = [...new Set(runs.map((r) => r.config))].sort();
  return configs.map((config) => {
    const summary: ConfigSummary = {
      config,
      runs: 0,
      reviewedRuns: 0,
      correct: 0,
      falseApprovals: 0,
      notSolvableRuns: 0,
      unnecessaryBlocks: 0,
      solvableRuns: 0,
      failedRuns: 0,
      tokens: 0,
      tokensPerCorrect: null,
      rows: [],
    };
    for (const run of runs.filter((r) => r.config === config)) {
      const reference = byId.get(run.caseId);
      if (!reference) throw new Error(`${run.file}: unknown reference case "${run.caseId}"`);
      const { verdict, result } = scoreRun(reference, run.report);
      const tokens = run.report.tokens?.used ?? 0;
      summary.runs++;
      summary.rows.push({ caseId: run.caseId, file: run.file, reviewed: reference.reviewed, verdict, result, tokens });
      if (!reference.reviewed) continue;
      summary.reviewedRuns++;
      summary.tokens += tokens;
      if (reference.correct.includes("recommended")) summary.solvableRuns++;
      else summary.notSolvableRuns++;
      if (result === "correct") summary.correct++;
      if (result === "false_approval") summary.falseApprovals++;
      if (result === "unnecessary_block") summary.unnecessaryBlocks++;
      if (result === "failed_run") summary.failedRuns++;
    }
    summary.tokensPerCorrect = summary.correct > 0 ? Math.round(summary.tokens / summary.correct) : null;
    return summary;
  });
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((100 * n) / of)} % (${n}/${of})` : "–");

export function summaryToMarkdown(summaries: ConfigSummary[]): string {
  const lines = [
    "# Consyrium reference set (#182)",
    "",
    "| Configuration | Runs (reviewed) | Correct verdicts | False approvals | Unnecessary blocks | Failed runs | Tokens per correct verdict |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const s of summaries)
    lines.push(
      `| ${s.config} | ${s.runs} (${s.reviewedRuns}) | ${pct(s.correct, s.reviewedRuns)} | ${pct(s.falseApprovals, s.notSolvableRuns)} | ${pct(s.unnecessaryBlocks, s.solvableRuns)} | ${pct(s.failedRuns, s.reviewedRuns)} | ${s.tokensPerCorrect?.toLocaleString("en-US") ?? "–"} |`,
    );
  const drafts = summaries.flatMap((s) => s.rows.filter((r) => !r.reviewed).map((r) => `${s.config}/${r.caseId}`));
  if (drafts.length > 0) lines.push("", `Not counted – label not yet reviewed by a human: ${drafts.join(", ")}`);
  for (const s of summaries) {
    lines.push("", `## ${s.config}`, "", "| Case | Verdict | Result | Tokens |", "|---|---|---|---|");
    for (const r of s.rows)
      lines.push(`| ${r.caseId}${r.reviewed ? "" : " (draft label)"} | ${r.verdict} | ${r.result} | ${r.tokens.toLocaleString("en-US")} |`);
  }
  return lines.join("\n");
}
