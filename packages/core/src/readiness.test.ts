import { describe, expect, it } from "vitest";
import { pullRequestReadiness } from "./readiness";

const review = (severity: string) => ({ focus: "security", verdict: "request_changes", findings: [{ severity, file: "src/a.ts", issue: "problem" }] });

describe("pull request readiness (quality gate)", () => {
  it("passes green tests with minor findings", () => {
    expect(pullRequestReadiness([{ kind: "test:install", status: "passed" }, { kind: "test", status: "passed" }], [review("low")])).toEqual({ blocked: false, reasons: [], warnings: [] });
  });
  it("blocks failed tests and failed installs, but only warns when no runtime existed", () => {
    expect(pullRequestReadiness([{ kind: "test", status: "failed" }], []).blocked).toBe(true);
    expect(pullRequestReadiness([{ kind: "repair-1:install", status: "failed" }, { kind: "repair-1", status: "not_run" }], []).reasons[0]).toMatch(/Installing dependencies failed/);
    const notRun = pullRequestReadiness([{ kind: "test:install", status: "not_run" }, { kind: "test", status: "not_run" }], []);
    expect(notRun.blocked).toBe(false);
    expect(notRun.warnings[0]).toMatch(/not executed/);
  });
  it("uses only the latest run after repairs", () => {
    expect(pullRequestReadiness([{ kind: "test", status: "failed" }, { kind: "repair-1", status: "passed" }], []).blocked).toBe(false);
  });
  it("blocks critical review findings and warns about high ones", () => {
    expect(pullRequestReadiness([{ kind: "test", status: "passed" }], [review("critical")]).reasons[0]).toMatch(/critical review finding/);
    expect(pullRequestReadiness([{ kind: "test", status: "passed" }], [review("high")]).warnings[0]).toMatch(/high-severity/);
  });
});
