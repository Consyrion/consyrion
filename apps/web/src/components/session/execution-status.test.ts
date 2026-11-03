import { describe, expect, it } from "vitest";
import { executionStates } from "./execution-status";

describe("execution tab states (#91)", () => {
  it("shows a finished build with a draft PR as completed and tests that never ran as not run – not passed", () => {
    const s = executionStates({ plan: { status: "completed", pullRequestUrl: "https://github.com/o/r/pull/1" }, tests: [{ status: "not_run" }, { status: "not_run" }], reviews: [{}, {}] });
    expect(s.build).toBe("completed");
    expect(s.buildText).toBe("code generated, draft PR opened");
    expect(s.reviewTests).toBe("blocked");
    expect(s.reviewTestsText).toBe("tests not run");
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
