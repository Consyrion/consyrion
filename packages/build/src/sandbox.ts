import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, statfs } from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Generated code is untrusted. It is only ever executed inside a container with no host
 * credentials, dropped capabilities, resource limits and (for tests) no network. There is no
 * fallback that runs commands on the host: without a container runtime, runs report "not_run".
 */
/**
 * Pinned by digest (#399): a tag can be moved to a different image upstream; a digest cannot. Multi-arch index digests
 * (08.11.26) – update them deliberately, together with the pre-pull in deploy/hetzner/setup-server.sh.
 */
export const SANDBOX_IMAGES = {
  node: "node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202",
  python: "python:3.12-alpine@sha256:e064671ca452259bab50e8e2c7bd896e39e9a343bb06ca25234adf6fe18d0fc7",
} as const;

/**
 * Network for dependency installation (#399). Never Docker's default bridge: it reaches the host, the LAN and the cloud
 * metadata service. The operator creates this network and its firewall with deploy/hetzner/sandbox-network.sh
 * (drops RFC 1918, 169.254.0.0/16, 100.64.0.0/10 and the host); the script then writes a marker with the current boot
 * id. Without network or marker an install is refused, not run on another network (fail closed).
 */
export const DEFAULT_EGRESS_NETWORK = "consyrion-sandbox-egress";
export const DEFAULT_EGRESS_MARKER = "/srv/consyrion/workspaces/.sandbox-egress-firewall";
/** Workspace size limit while a command runs, and the free space required before it starts (#399; ENOSPC on the server). */
export const DEFAULT_WORKSPACE_MAX_MB = 2048;
export const DEFAULT_MIN_FREE_MB = 2048;
export type SandboxStack = keyof typeof SANDBOX_IMAGES;

export interface SandboxRunRequest {
  stack: SandboxStack;
  workspaceDir: string;
  command: string;
  /** Network is only allowed for dependency installation; tests always run offline. */
  network: "none" | "egress";
  timeoutMs: number;
}

export interface SandboxResult {
  status: "passed" | "failed" | "error" | "timeout" | "not_run";
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export interface Sandbox {
  readonly name: string;
  available(): Promise<boolean>;
  run(request: SandboxRunRequest): Promise<SandboxResult>;
}

const MAX_OUTPUT = 20_000;

function truncate(output: string) {
  return output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT / 2)}\n…[truncated]…\n${output.slice(-MAX_OUTPUT / 2)}` : output;
}

export class DockerSandbox implements Sandbox {
  readonly name = "docker";
  constructor(private readonly binary = process.env.SANDBOX_DOCKER_BINARY ?? "docker") {}

  async available(): Promise<boolean> {
    try {
      await promisify(execFile)(this.binary, ["info", "--format", "{{.ServerVersion}}"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds the container arguments; exported for tests of the isolation settings. `runtime` selects an OCI
   * runtime such as gVisor (`runsc`, set via SANDBOX_DOCKER_RUNTIME on the server) for a user-space kernel
   * between generated code and the host.
   */
  static args(
    request: SandboxRunRequest,
    name: string,
    runtime = process.env.SANDBOX_DOCKER_RUNTIME ?? "",
    egressNetwork = process.env.SANDBOX_EGRESS_NETWORK || DEFAULT_EGRESS_NETWORK,
  ): string[] {
    if (runtime && !/^[a-z0-9_-]+$/i.test(runtime)) throw new Error("Invalid SANDBOX_DOCKER_RUNTIME");
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(egressNetwork) || ["bridge", "host", "default"].includes(egressNetwork))
      throw new Error("Invalid SANDBOX_EGRESS_NETWORK – a dedicated network is required");
    return [
      "run",
      "--rm",
      "--name",
      name,
      ...(runtime ? ["--runtime", runtime] : []),
      "--network",
      request.network === "none" ? "none" : egressNetwork,
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--pids-limit",
      "256",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "1000:1000",
      // Read-only image filesystem (#399): only the workspace and a small /tmp are writable.
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=256m",
      "--ulimit",
      "nofile=1024:2048",
      "--env",
      "HOME=/workspace/.home",
      "--env",
      "CI=1",
      "-v",
      `${request.workspaceDir}:/workspace:rw`,
      "-w",
      "/workspace",
      SANDBOX_IMAGES[request.stack],
      "sh",
      "-c",
      request.command,
    ];
  }

  /**
   * Why an install must not start: the egress network or its firewall marker is missing (#399). Null when both are in
   * place. The marker holds the boot id the firewall script ran in, so rules lost by a reboot are noticed.
   */
  async egressProblem(env: Record<string, string | undefined> = process.env): Promise<string | null> {
    const network = env.SANDBOX_EGRESS_NETWORK || DEFAULT_EGRESS_NETWORK;
    try {
      await promisify(execFile)(this.binary, ["network", "inspect", "--format", "{{.Name}}", network], { timeout: 10_000 });
    } catch {
      return `The sandbox network "${network}" does not exist – the install was not run (deploy/hetzner/sandbox-network.sh creates it).`;
    }
    try {
      const marker = (await readFile(env.SANDBOX_EGRESS_MARKER || DEFAULT_EGRESS_MARKER, "utf8")).trim();
      const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      if (marker !== bootId)
        return "The sandbox firewall was not set up since the last restart – the install was not run (run deploy/hetzner/sandbox-network.sh).";
    } catch {
      return "The sandbox firewall marker is missing – the install was not run (run deploy/hetzner/sandbox-network.sh).";
    }
    return null;
  }

  async run(request: SandboxRunRequest): Promise<SandboxResult> {
    const name = `consyrion-${randomUUID()}`;
    const started = Date.now();
    const refuse = (output: string): SandboxResult => ({ status: "error", exitCode: null, output, durationMs: Date.now() - started });
    if (request.network === "egress") {
      const problem = await this.egressProblem();
      if (problem) return refuse(problem);
    }
    const maxMb = Number(process.env.SANDBOX_WORKSPACE_MAX_MB) || DEFAULT_WORKSPACE_MAX_MB;
    const minFreeMb = Number(process.env.SANDBOX_MIN_FREE_MB) || DEFAULT_MIN_FREE_MB;
    try {
      const fs = await statfs(request.workspaceDir);
      const freeMb = (fs.bavail * fs.bsize) / 1024 / 1024;
      if (freeMb < minFreeMb) return refuse(`Not run: only ${Math.floor(freeMb)} MB free on the workspace disk, ${minFreeMb} MB are required.`);
    } catch {
      // statfs is unavailable on some platforms; the size watchdog below still applies.
    }
    return new Promise<SandboxResult>((resolve) => {
      // An empty environment: no host variables (API keys, tokens) reach the docker client either.
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv;
      const child = spawn(this.binary, DockerSandbox.args(request, name), { env });
      let output = "";
      let timedOut = false;
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.length > MAX_OUTPUT * 4) output = output.slice(-MAX_OUTPUT * 2);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => {
        timedOut = true;
        spawn(this.binary, ["kill", name]);
      }, request.timeoutMs);
      // Workspace size watchdog (#399): a bind mount has no quota, so the worker measures it and stops the container.
      let tooLarge = false;
      const watchdog = setInterval(() => {
        workspaceMb(request.workspaceDir).then((mb) => {
          if (mb !== null && mb > maxMb && !tooLarge) {
            tooLarge = true;
            spawn(this.binary, ["kill", name]);
          }
        });
      }, 5_000);
      child.on("error", (error) => {
        clearTimeout(timer);
        clearInterval(watchdog);
        resolve({ status: "error", exitCode: null, output: truncate(`Sandbox could not start: ${error.message}`), durationMs: Date.now() - started });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(watchdog);
        resolve({
          status: tooLarge ? "error" : timedOut ? "timeout" : code === 0 ? "passed" : "failed",
          exitCode: code,
          output: truncate(tooLarge ? `${output}\nStopped: the workspace grew beyond ${maxMb} MB.` : output),
          durationMs: Date.now() - started,
        });
      });
    });
  }
}

/** Size of a directory in MB via `du -sk` (busybox and coreutils); null when it cannot be measured. */
async function workspaceMb(dir: string): Promise<number | null> {
  try {
    const { stdout } = await promisify(execFile)("du", ["-sk", dir], { timeout: 4_000 });
    const kb = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb / 1024 : null;
  } catch {
    return null;
  }
}

/** Used when no container runtime exists (or the operator disabled it). Never executes anything. */
export class UnavailableSandbox implements Sandbox {
  readonly name = "none";
  constructor(private readonly reason = "No container runtime is available; the command was not executed.") {}
  async available() {
    return false;
  }
  async run(): Promise<SandboxResult> {
    return { status: "not_run", exitCode: null, output: this.reason, durationMs: 0 };
  }
}

/** Message of a run on an installation with SANDBOX_DISABLED=true (hosted app: tests run in the user's GitHub CI). */
export const SANDBOX_DISABLED_REASON = "Not run on CONSYRION AI: tests run in your repository's GitHub Actions once the draft pull request is open.";

export async function detectSandbox(env: Record<string, string | undefined> = process.env): Promise<Sandbox> {
  if (/^(1|true|yes)$/i.test(env.SANDBOX_DISABLED ?? "")) return new UnavailableSandbox(SANDBOX_DISABLED_REASON);
  const docker = new DockerSandbox();
  return (await docker.available()) ? docker : new UnavailableSandbox();
}
