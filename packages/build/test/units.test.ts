import { describe, expect, it } from "vitest";
import { readyTasks, validateDag } from "../src/dag";
import { pullRequestTitle } from "../src/github";
import { DockerSandbox, UnavailableSandbox } from "../src/sandbox";
import { safeRelativePath } from "../src/workspace";

describe("workspace paths", () => {
  it("accepts normal relative paths", () => {
    expect(safeRelativePath("src/index.ts")).toBe("src/index.ts");
    expect(safeRelativePath("./a/../b.txt")).toBe("b.txt");
  });
  it.each(["../etc/passwd", "/etc/passwd", "a/../../x", "C:/Windows/x", ".git/config", "src/.git/hooks/pre-commit", ".github/workflows/x.yml", "", "dir/", "a\u0000b"])("rejects %j", (path) => {
    expect(safeRelativePath(path)).toBeNull();
  });
});

describe("task graph", () => {
  it("detects unknown dependencies, duplicates and cycles", () => {
    expect(validateDag([{ key: "T1", dependsOn: [] }, { key: "T2", dependsOn: ["T1"] }])).toEqual([]);
    expect(validateDag([{ key: "T1", dependsOn: ["T9"] }])[0]).toMatch(/unknown/);
    expect(validateDag([{ key: "T1", dependsOn: [] }, { key: "T1", dependsOn: [] }])[0]).toMatch(/Duplicate/);
    expect(validateDag([{ key: "A", dependsOn: ["B"] }, { key: "B", dependsOn: ["A"] }])[0]).toMatch(/cycle/);
  });
  it("releases tasks only after their dependencies are done", () => {
    const tasks = [
      { key: "T1", dependsOn: [], status: "done" },
      { key: "T2", dependsOn: ["T1"], status: "pending" },
      { key: "T3", dependsOn: ["T2"], status: "pending" },
      { key: "T4", dependsOn: [], status: "pending" },
    ];
    expect(readyTasks(tasks).map((t) => t.key)).toEqual(["T2", "T4"]);
  });
});

describe("sandbox", () => {
  it("isolates containers: no network for tests, dropped capabilities, limits, unprivileged user", () => {
    const args = DockerSandbox.args({ stack: "node", workspaceDir: "/tmp/ws", command: "npm test", network: "none", timeoutMs: 1000 }, "x");
    const joined = args.join(" ");
    expect(joined).toContain("--network none");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--security-opt no-new-privileges");
    expect(joined).toContain("--memory 1g");
    expect(joined).toContain("--pids-limit 256");
    expect(joined).toContain("--user 1000:1000");
    expect(joined).not.toContain("--privileged");
    expect(joined).not.toMatch(/docker\.sock/);
  });
  it("runs generated code under gVisor when a sandbox runtime is configured", () => {
    const request = { stack: "node" as const, workspaceDir: "/srv/consyrion/workspaces/ws", command: "npm test", network: "none" as const, timeoutMs: 1000 };
    expect(DockerSandbox.args(request, "x", "runsc").join(" ")).toContain("--runtime runsc");
    expect(DockerSandbox.args(request, "x", "").join(" ")).not.toContain("--runtime");
    expect(() => DockerSandbox.args(request, "x", "runsc --privileged")).toThrow();
  });
  it("never executes anything without a container runtime", async () => {
    expect(await new UnavailableSandbox().run()).toMatchObject({ status: "not_run" });
  });
});

const dockerAvailable = await new DockerSandbox().available();
describe.skipIf(!dockerAvailable)("docker sandbox (integration, runs where Docker exists, e.g. CI)", () => {
  it("runs a command and blocks network access during tests", async () => {
    const { materialize } = await import("../src/workspace");
    const ws = await materialize(new Map([["check.js", "require('fs').writeFileSync('out.txt','ok');console.log('hello')"]]));
    try {
      const sandbox = new DockerSandbox();
      const ok = await sandbox.run({ stack: "node", workspaceDir: ws.dir, command: "node check.js", network: "none", timeoutMs: 120_000 });
      expect(ok.status).toBe("passed");
      expect(ok.output).toContain("hello");
      const offline = await sandbox.run({ stack: "node", workspaceDir: ws.dir, command: "node -e \"require('https').get('https://example.com',()=>process.exit(0)).on('error',()=>process.exit(3))\"", network: "none", timeoutMs: 120_000 });
      expect(offline.exitCode).toBe(3);
      const slow = await sandbox.run({ stack: "node", workspaceDir: ws.dir, command: "sleep 30", network: "none", timeoutMs: 2_000 });
      expect(slow.status).toBe("timeout");
    } finally {
      await ws.cleanup();
    }
  }, 180_000);
});

describe("pull request title", () => {
  it("uses a short first sentence, else the first task, and never cuts a word", () => {
    expect(pullRequestTitle("Add remove(id). Then write tests.")).toBe("CONSYRION AI: Add remove(id)");
    // GitHub build test 08.11.26: a long summary sentence gives way to the first task's title.
    expect(
      pullRequestTitle("Implement Option A in src/todos.js: add search(query) that validates input, trims and lowercases the query.", "Add search(query) to the todo store"),
    ).toBe("CONSYRION AI: Add search(query) to the todo store");
    const long = pullRequestTitle("Implement an additive, synchronous remove(id) method on the in-memory store returned by createStore in src/todos.js and more");
    expect(long.length).toBeLessThanOrEqual(72);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/src\/to…$/);
    expect(pullRequestTitle(null)).toBe("CONSYRION AI: Implement approved decision");
  });
});
