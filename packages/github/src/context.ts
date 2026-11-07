import type { GitHubClient } from "./client";
import { containsSecret, isReadablePath, type RepoInfo } from "./repository";

/**
 * Repository context for Decision councils: the user picks files of the linked repository, CONSYRION reads exactly
 * those at one commit, and they reach the models as one frozen context document. No model chooses what is read.
 */
export const CONTEXT_LIMITS = { maxFileBytes: 100_000, maxTotalBytes: 180_000, suggestedBytes: 60_000, maxFiles: 60, maxTreeEntries: 400 } as const;

export interface TreeEntry {
  path: string;
  size: number;
  sha: string;
}

export interface RepositoryTree {
  commitSha: string;
  /** Text files that may be read (filters of the snapshot: no build output, binaries or secret-looking paths). */
  files: TreeEntry[];
  /** Every path of the default branch, for the overview at the top of the context. */
  paths: string[];
  truncated: boolean;
}

/** The default branch's tree at its current commit, without reading any file content. */
export async function readRepositoryTree(client: GitHubClient, repo: RepoInfo): Promise<RepositoryTree> {
  const ref = await client.request<{ object: { sha: string } }>("GET", `/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`);
  const commit = await client.request<{ tree: { sha: string } }>("GET", `/repos/${repo.fullName}/git/commits/${ref.object.sha}`);
  const tree = await client.request<{ tree: Array<{ path: string; type: string; sha: string; size?: number }>; truncated: boolean }>(
    "GET",
    `/repos/${repo.fullName}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  const blobs = tree.tree.filter((e) => e.type === "blob");
  return {
    commitSha: ref.object.sha,
    files: blobs
      .filter((e) => isReadablePath(e.path) && (e.size ?? 0) <= CONTEXT_LIMITS.maxFileBytes)
      .map((e) => ({ path: e.path, size: e.size ?? 0, sha: e.sha })),
    paths: blobs.map((e) => e.path),
    truncated: tree.truncated,
  };
}

const DOC = /(^|\/)(readme|claude|agents|architecture|contributing)[^/]*\.(md|markdown|txt)$/i;
const MARKDOWN = /\.(md|markdown)$/i;

/** Words of at least five letters, lower case: enough to rank file paths against the brief without a model. */
function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\d]{5,}/gu) ?? []).filter((w) => !/^\d+$/.test(w)));
}

/**
 * The files proposed for the context, as a deterministic suggestion the user changes: files the brief names first, then
 * README-like files, then Markdown documentation ranked by how many brief terms its path contains (unmatched ones last), until `suggestedBytes`.
 */
export function suggestContextFiles(files: readonly TreeEntry[], brief: string): string[] {
  const words = terms(brief);
  const score = (f: TreeEntry) => {
    const pathWords = f.path.toLowerCase().split(/[^\p{L}\d]+/u);
    // The same first five letters count as a match, so "latency" meets "Latenz" and "jitter-buffer" meets "Jitter".
    const stems = new Set([...words].map((t) => t.slice(0, 5)));
    const hits = pathWords.filter((w) => w.length >= 5 && stems.has(w.slice(0, 5))).length;
    return (DOC.test(f.path) && !f.path.includes("/") ? 100 : DOC.test(f.path) ? 50 : 0) + hits * 10 - f.path.split("/").length;
  };
  // Files the brief names by path or file name ("src/todos.js", "todos.js") come first, whatever their type (night test
  // 07.11.26: the requirements named src/todos.js, the suggestion was README.md only).
  const lower = brief.toLowerCase();
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = (f: TreeEntry) => {
    const name = f.path.split("/").at(-1)!.toLowerCase();
    if (lower.includes(f.path.toLowerCase())) return true;
    // A bare file name counts only with an extension and as a whole word ("todos.js", not "s.js" inside "todos.js").
    return name.includes(".") && name.length >= 5 && new RegExp(`(^|[^\\w./-])${escape(name)}($|[^\\w])`).test(lower);
  };
  const mentioned = files.filter(named).sort((a, b) => a.path.localeCompare(b.path));
  const ranked = [
    ...mentioned,
    ...files.filter((f) => !named(f) && (MARKDOWN.test(f.path) || DOC.test(f.path))).sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path)),
  ];
  const chosen: string[] = [];
  let total = 0;
  for (const f of ranked) {
    if (total + f.size > CONTEXT_LIMITS.suggestedBytes) continue;
    chosen.push(f.path);
    total += f.size;
  }
  return chosen;
}

export interface ContextFile {
  path: string;
  content: string;
}

/**
 * Reads the chosen files at exactly `tree.commitSha` (their blob ids come from that tree). Paths that are not readable
 * text files of the tree are refused; files with credential-like content are left out and named.
 */
export async function readContextFiles(
  client: GitHubClient,
  repo: RepoInfo,
  tree: RepositoryTree,
  paths: readonly string[],
): Promise<{ files: ContextFile[]; skipped: Array<{ path: string; reason: string }> }> {
  const byPath = new Map(tree.files.map((f) => [f.path, f]));
  const unknown = paths.filter((p) => !byPath.has(p));
  if (unknown.length) throw new Error(`Not readable text files of this commit: ${unknown.slice(0, 3).join(", ")}`);
  if (paths.length > CONTEXT_LIMITS.maxFiles) throw new Error(`At most ${CONTEXT_LIMITS.maxFiles} files`);
  const total = paths.reduce((sum, p) => sum + byPath.get(p)!.size, 0);
  if (total > CONTEXT_LIMITS.maxTotalBytes)
    throw new Error(`The chosen files have ${Math.round(total / 1000)} kB; at most ${CONTEXT_LIMITS.maxTotalBytes / 1000} kB`);
  const files: ContextFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const path of [...new Set(paths)]) {
    const blob = await client.request<{ content: string; encoding: string }>("GET", `/repos/${repo.fullName}/git/blobs/${byPath.get(path)!.sha}`);
    const buffer = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8");
    if (buffer.includes(0)) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    const content = buffer.toString("utf8");
    if (containsSecret(content)) {
      skipped.push({ path, reason: "contains a credential-like value" });
      continue;
    }
    files.push({ path, content });
  }
  return { files, skipped };
}

/** The one context document the models read: repository, commit, an abridged file tree, then each chosen file. */
export function contextDocument(repo: RepoInfo, tree: RepositoryTree, files: readonly ContextFile[]): string {
  const shown = tree.paths.slice(0, CONTEXT_LIMITS.maxTreeEntries);
  return [
    `# Repository ${repo.fullName} at commit ${tree.commitSha.slice(0, 12)} (branch ${repo.defaultBranch})`,
    "",
    "Context read from the repository for this decision. It describes the existing project; it is not a list of requirements.",
    "",
    `## File tree (${tree.paths.length} files${tree.paths.length > shown.length ? `, first ${shown.length} shown` : ""}${tree.truncated ? ", truncated by GitHub" : ""})`,
    "",
    ...shown.map((p) => `- ${p}`),
    "",
    ...files.flatMap((f) => [`## File: ${f.path}`, "", "```", f.content.replace(/```/g, "ʼʼʼ"), "```", ""]),
  ].join("\n");
}
