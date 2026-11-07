/**
 * Tab states of the Execution Council and Review & Tests, derived from the actual build run (#91) instead of the
 * stored phase row, which older or finished runs never updated. Missing tests are never shown as passed.
 */

export type StageState = "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";

const ACTIVE = new Set(["queued", "planning", "awaiting_plan_approval", "running", "reviewing", "cancel_requested"]);

export interface ExecutionFacts {
  plan: { status: string; pullRequestUrl?: string | null };
  tests: Array<{ status: string }>;
  reviews: Array<unknown>;
}

export interface ExecutionStates {
  build: StageState;
  reviewTests: StageState;
  /** Short words for screen readers and tooltips, e.g. "tests not run". */
  buildText: string;
  reviewTestsText: string;
}

export function executionStates(exec: ExecutionFacts | null): ExecutionStates {
  if (!exec) return { build: "pending", reviewTests: "pending", buildText: "not started", reviewTestsText: "not started" };
  const status = exec.plan.status;
  const build: StageState = ACTIVE.has(status) ? "running" : status === "completed" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "pending";
  const buildText =
    build === "completed" ? (exec.plan.pullRequestUrl ? "code generated, draft PR opened" : "code generated") : status === "awaiting_plan_approval" ? "plan awaiting approval" : build === "running" ? "running" : build;

  const latest = exec.tests.at(-1)?.status;
  let reviewTests: StageState;
  let reviewTestsText: string;
  if (!latest) {
    // Reviews without any test run: tests were not executed, which must not look like success.
    if (exec.reviews.length > 0 && build !== "running") [reviewTests, reviewTestsText] = ["blocked", "reviewed, tests not run"];
    else [reviewTests, reviewTestsText] = [build === "running" ? "running" : "pending", build === "running" ? "running" : "not started"];
  } else if (latest === "passed") [reviewTests, reviewTestsText] = ["completed", exec.reviews.length > 0 ? "tests passed, reviewed" : "tests passed"];
  // GitHub build test 08.11.26: without a sandbox the draft PR's GitHub Actions run the tests – that is the expected
  // path, not a warning; whether they passed is shown on the Review & Tests screen (live CI checks).
  else if (latest === "not_run" && exec.plan.pullRequestUrl) [reviewTests, reviewTestsText] = ["pending", "tests run in GitHub Actions"];
  else if (latest === "not_run") [reviewTests, reviewTestsText] = ["blocked", "tests not run"];
  else [reviewTests, reviewTestsText] = ["failed", latest === "timeout" ? "tests timed out" : "tests failed"];
  if (build === "running" && reviewTests !== "failed") [reviewTests, reviewTestsText] = ["running", "running"];
  return { build, reviewTests, buildText, reviewTestsText };
}
