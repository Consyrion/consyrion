import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const WORKSPACE_LIMITS = { maxFileBytes: 200_000, maxFiles: 200, maxPathLength: 200 } as const;

/**
 * Validates a model-chosen file path. Only relative paths inside the workspace are allowed; no
 * traversal, no absolute paths, no VCS or CI configuration that could change repository behaviour.
 */
export function safeRelativePath(input: string): string | null {
  const value = input.trim().replace(/\\/g, "/");
  if (!value || value.length > WORKSPACE_LIMITS.maxPathLength || value.includes("\u0000")) return null;
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return null;
  const normalized = path.posix.normalize(value);
  if (normalized.startsWith("..") || normalized.split("/").includes("..")) return null;
  if (/^(\.git|\.github)(\/|$)/.test(normalized) || normalized.split("/").includes(".git")) return null;
  if (normalized === "." || normalized.endsWith("/")) return null;
  return normalized;
}

export function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

/** Writes files into a fresh temporary directory for one sandbox run. */
export async function materialize(files: ReadonlyMap<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "consyrion-ws-"));
  for (const [relative, content] of files) {
    const safe = safeRelativePath(relative);
    if (!safe) continue;
    // Runtime path inside a temp directory; excluded from Next.js output tracing.
    const target = path.join(/* turbopackIgnore: true */ dir, safe);
    if (!target.startsWith(dir + path.sep)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await mkdir(path.join(dir, ".home"), { recursive: true });
  // The container runs as an unprivileged uid that differs from the host user; the throwaway
  // workspace must be writable for it (e.g. node_modules). It is deleted after the run.
  await openPermissions(dir);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function openPermissions(dir: string): Promise<void> {
  await chmod(dir, 0o777);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await openPermissions(full);
    else await chmod(full, 0o666);
  }
}
