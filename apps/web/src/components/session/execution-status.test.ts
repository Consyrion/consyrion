import { describe, expect, it } from "vitest";
import { executionStates } from "./execution-status";

describe("execution tab states (#91)", () => {
  it("shows a finished build with a draft PR as completed and tests that never ran here as running in GitHub – not passed", () => {
    const s = executionStates({ plan: { status: "completed", pullRequestUrl: "https://github.com/o/r/pull/1" }, tests: [{ status: "not_run" }, { status: "not_run" }], reviews: [{}, {}] });
    expect(s.build).toBe("completed");
    expect(s.buildText).toBe("code generated, draft PR opened");
    // GitHub build test 08.11.26: the draft PR's GitHub Actions run them – neutral, never "passed".
    expect(s.reviewTests).toBe("pending");
    expect(s.reviewTestsText).toBe("tests run in GitHub Actions");
    // Without a pull request they still read as not run.
    expect(executionStates({ plan: { status: "completed" }, tests: [{ status: "not_run" }], reviews: [] }).reviewTestsText).toBe("tests not run");
  });

  it("keeps running, failed, cancelled and not started runs apart", () => {
    expect(executionStates(null)).toMatchObject({ build: "pending", reviewTests: "pending" });
    expect(executionStates({ plan: { status: "running" }, tests: [], reviews: [] })).toMatchObject({ build: "running", reviewTests: "running" });
    expect(executionStates({ plan: { status: "awaiting_plan_approval" }, tests: [], reviews: [] }).buildText).toBe("plan awaiting approval");
    expect(executionStates({ plan: { status: "failed" }, tests: [{ status: "failed" }], reviews: [] })).toMatchObject({ build: "failed", reviewTests: "failed" });
    expect(executionStates({ plan: { status: "cancelled" }, tests: [], reviews: [] })).toMatchObject({ build: "cancelled", reviewTests: "pending" });
    expect(executionStates({ plan: { status: "completed" }, tests: [{ status: "passed" }], reviews: [{}] })).toMatchObject({ reviewTests: "completed", reviewTestsText: "tests passed, reviewed" });
    expect(executionStates({ plan: { status: "completed" }, tests: [], reviews: [{}] })).toMatchObject({ reviewTests: "blocked", reviewTestsText: "reviewed, tests not run" });
  });
});
