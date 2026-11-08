import { describe, expect, it } from "vitest";
import { readyTasks, validateDag } from "../src/dag";
import { pullRequestTitle } from "../src/github";
import { DockerSandbox, SANDBOX_IMAGES, UnavailableSandbox } from "../src/sandbox";
import { safeRelativePath } from "../src/workspace";

describe("workspace paths", () => {
  it("accepts normal relative paths", () => {
    expect(safeRelativePath("src/index.ts")).toBe("src/index.ts");
    expect(safeRelativePath("./a/../b.txt")).toBe("b.txt");
  });
  it.each([
    "../etc/passwd",
    "/etc/passwd",
    "a/../../x",
    "C:/Windows/x",
    ".git/config",
    "src/.git/hooks/pre-commit",
    ".github/workflows/x.yml",
    "",
    "dir/",
    "a\u0000b",
  ])("rejects %j", (path) => {
    expect(safeRelativePath(path)).toBeNull();
  });
});

describe("task graph", () => {
  it("detects unknown dependencies, duplicates and cycles", () => {
    expect(
      validateDag([
        { key: "T1", dependsOn: [] },
        { key: "T2", dependsOn: ["T1"] },
      ]),
    ).toEqual([]);
    expect(validateDag([{ key: "T1", dependsOn: ["T9"] }])[0]).toMatch(/unknown/);
    expect(
      validateDag([
        { key: "T1", dependsOn: [] },
        { key: "T1", dependsOn: [] },
      ])[0],
    ).toMatch(/Duplicate/);
    expect(
      validateDag([
        { key: "A", dependsOn: ["B"] },
        { key: "B", dependsOn: ["A"] },
      ])[0],
    ).toMatch(/cycle/);
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
  it("hardens the container (#399): read-only image, small /tmp, file limit, pinned images, own install network", () => {
    const install = { stack: "node" as const, workspaceDir: "/tmp/ws", command: "npm ci", network: "egress" as const, timeoutMs: 1000 };
    const joined = DockerSandbox.args(install, "x", "", "consyrion-sandbox-egress").join(" ");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--tmpfs /tmp:rw,nosuid,nodev,size=256m");
    expect(joined).toContain("--ulimit nofile=1024:2048");
    expect(joined).toContain("--network consyrion-sandbox-egress");
    expect(joined).not.toContain("--network bridge");
    expect(Object.values(SANDBOX_IMAGES).every((image) => /@sha256:[0-9a-f]{64}$/.test(image))).toBe(true);
    // Docker's default networks reach host, LAN and metadata – never accepted as install network.
    for (const network of ["bridge", "host", "default", "a b"]) expect(() => DockerSandbox.args(install, "x", "", network)).toThrow();
  });
  it("refuses an install when the egress network or its firewall marker is missing (#399, fail closed)", async () => {
    const { mkdtemp, writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "egress-"));
    const marker = join(dir, "marker");
    // "false" fails like `docker network inspect` for a missing network, "true" succeeds like an existing one.
    expect(await new DockerSandbox("false").egressProblem({ SANDBOX_EGRESS_MARKER: marker })).toMatch(/does not exist/);
    expect(await new DockerSandbox("true").egressProblem({ SANDBOX_EGRESS_MARKER: marker })).toMatch(/marker is missing/);
    await writeFile(marker, "an-earlier-boot");
    const linux = await readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => null);
    if (linux) {
      expect(await new DockerSandbox("true").egressProblem({ SANDBOX_EGRESS_MARKER: marker })).toMatch(/since the last restart/);
      await writeFile(marker, linux);
      expect(await new DockerSandbox("true").egressProblem({ SANDBOX_EGRESS_MARKER: marker })).toBeNull();
    }
    const refused = await new DockerSandbox("false").run({ stack: "node", workspaceDir: dir, command: "npm ci", network: "egress", timeoutMs: 1000 });
    expect(refused).toMatchObject({ status: "error", exitCode: null });
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
      const offline = await sandbox.run({
        stack: "node",
        workspaceDir: ws.dir,
        command: "node -e \"require('https').get('https://example.com',()=>process.exit(0)).on('error',()=>process.exit(3))\"",
        network: "none",
        timeoutMs: 120_000,
      });
      expect(offline.exitCode).toBe(3);
      const slow = await sandbox.run({ stack: "node", workspaceDir: ws.dir, command: "sleep 30", network: "none", timeoutMs: 2_000 });
      expect(slow.status).toBe("timeout");
      // Read-only image filesystem (#399): /etc is not writable, /tmp and the workspace are.
      const fsCheck = await sandbox.run({
        stack: "node",
        workspaceDir: ws.dir,
        command: "touch /etc/x 2>/dev/null && exit 9; touch /tmp/x && touch ./y",
        network: "none",
        timeoutMs: 120_000,
      });
      expect(fsCheck.status).toBe("passed");
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
      pullRequestTitle(
        "Implement Option A in src/todos.js: add search(query) that validates input, trims and lowercases the query.",
        "Add search(query) to the todo store",
      ),
    ).toBe("CONSYRION AI: Add search(query) to the todo store");
    const long = pullRequestTitle(
      "Implement an additive, synchronous remove(id) method on the in-memory store returned by createStore in src/todos.js and more",
    );
    expect(long.length).toBeLessThanOrEqual(72);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/src\/to…$/);
    expect(pullRequestTitle(null)).toBe("CONSYRION AI: Implement approved decision");
    // Night test R4: the approved proposal's title names the change, not the first task ("write the tests (red)").
    const named = pullRequestTitle(
      "Long plan summary sentence.",
      "Tests für rename() schreiben (rot)",
      72,
      "Option A: Titel per rename(id, newTitle) direkt im bestehenden Map-Eintrag aktualisieren",
    );
    expect(named.startsWith("CONSYRION AI: Option A: Titel per rename(id, newTitle)")).toBe(true);
    expect(named.length).toBeLessThanOrEqual(72);
    expect(named).not.toContain("Tests für");
  });
});

/**
 * #399 acceptance: the install network reaches the internet but not the cloud metadata service, the LAN or the host.
 * Runs in CI after `sudo deploy/hetzner/sandbox-network.sh` (SANDBOX_EGRESS_TEST=1); GitHub runners have a real
 * metadata endpoint at 169.254.169.254.
 */
describe.skipIf(!dockerAvailable || !process.env.SANDBOX_EGRESS_TEST)("sandbox egress firewall (integration, CI)", () => {
  it("blocks metadata, private ranges and the host during installs, and still reaches a public registry", async () => {
    const { materialize } = await import("../src/workspace");
    const ws = await materialize(new Map([["package.json", "{}"]]));
    const probe = (target: string) =>
      `node -e "const s=require('net').connect({host:'${target}',port:80,timeout:4000});s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(4));s.on('error',()=>process.exit(5))"`;
    try {
      const sandbox = new DockerSandbox();
      for (const target of ["169.254.169.254", "10.0.0.1", "192.168.0.1", "172.31.250.1"]) {
        const blocked = await sandbox.run({ stack: "node", workspaceDir: ws.dir, command: probe(target), network: "egress", timeoutMs: 60_000 });
        expect(blocked.exitCode, target).not.toBe(0);
      }
      const registry = await sandbox.run({
        stack: "node",
        workspaceDir: ws.dir,
        command: "node -e \"require('https').get('https://registry.npmjs.org/',r=>process.exit(r.statusCode<500?0:6)).on('error',()=>process.exit(7))\"",
        network: "egress",
        timeoutMs: 60_000,
      });
      expect(registry.exitCode).toBe(0);
    } finally {
      await ws.cleanup();
    }
  }, 300_000);
});
