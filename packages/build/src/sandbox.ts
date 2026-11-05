import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

/**
 * Generated code is untrusted. It is only ever executed inside a container with no host
 * credentials, dropped capabilities, resource limits and (for tests) no network. There is no
 * fallback that runs commands on the host: without a container runtime, runs report "not_run".
 */
export const SANDBOX_IMAGES = {
  node: "node:22-alpine",
  python: "python:3.12-alpine",
} as const;
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
  static args(request: SandboxRunRequest, name: string, runtime = process.env.SANDBOX_DOCKER_RUNTIME ?? ""): string[] {
    if (runtime && !/^[a-z0-9_-]+$/i.test(runtime)) throw new Error("Invalid SANDBOX_DOCKER_RUNTIME");
    return [
      "run",
      "--rm",
      "--name",
      name,
      ...(runtime ? ["--runtime", runtime] : []),
      "--network",
      request.network === "none" ? "none" : "bridge",
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

  async run(request: SandboxRunRequest): Promise<SandboxResult> {
    const name = `consyrion-${randomUUID()}`;
    const started = Date.now();
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
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ status: "error", exitCode: null, output: truncate(`Sandbox could not start: ${error.message}`), durationMs: Date.now() - started });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          status: timedOut ? "timeout" : code === 0 ? "passed" : "failed",
          exitCode: code,
          output: truncate(output),
          durationMs: Date.now() - started,
        });
      });
    });
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
