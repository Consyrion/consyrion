/**
 * Quality gate before a draft pull request (#46, #56, #25). Pure function, shared by the server (enforcing)
 * and the UI (explaining). Failed sandbox tests or critical review findings block publishing unless an
 * owner/admin overrides with a written reason; tests that could not run are only a warning.
 */
export interface ReadinessTest {
  kind: string;
  status: "passed" | "failed" | "error" | "timeout" | "not_run";
}

export interface ReadinessReview {
  focus: string;
  verdict: string;
  findings: Array<{ severity: string; file: string; issue: string }>;
}

export interface Readiness {
  blocked: boolean;
  reasons: string[];
  warnings: string[];
}

export const MIN_OVERRIDE_REASON = 10;

/** A coding task gets at most this many attempts over all resumes of a run (#107). */
export const MAX_TASK_ATTEMPTS = 3;

export function pullRequestReadiness(tests: ReadonlyArray<ReadinessTest>, reviews: ReadonlyArray<ReadinessReview>): Readiness {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const last = tests.filter((t) => !t.kind.endsWith(":install")).at(-1);
  // A failed dependency install leaves the test step "not run" – that is a failure, not a missing runtime.
  const install = last ? tests.find((t) => t.kind === `${last.kind}:install`) : undefined;
  if (install && install.status !== "passed" && install.status !== "not_run") reasons.push(`Installing dependencies ${install.status === "timeout" ? "timed out" : "failed"} in the latest sandbox run.`);
  else if (!last) warnings.push("No sandbox test run exists for this change.");
  else if (last.status === "not_run") warnings.push("Tests were not executed by CONSYRION AI (no sandbox on this server) – check the GitHub Actions of the draft pull request.");
  else if (last.status !== "passed") reasons.push(`The latest sandbox test run ${last.status === "timeout" ? "timed out" : last.status === "error" ? "errored" : "failed"}.`);
  const critical = reviews.flatMap((r) => r.findings.filter((f) => f.severity === "critical").map((f) => `${r.focus}: ${f.file} – ${f.issue}`));
  if (critical.length) reasons.push(`${critical.length} critical review finding(s): ${critical.slice(0, 3).join("; ")}${critical.length > 3 ? " …" : ""}`);
  const high = reviews.reduce((n, r) => n + r.findings.filter((f) => f.severity === "high").length, 0);
  if (high) warnings.push(`${high} high-severity review finding(s) – check them before merging.`);
  return { blocked: reasons.length > 0, reasons, warnings };
}
