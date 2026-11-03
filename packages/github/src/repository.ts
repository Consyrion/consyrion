import type { GitHubClient } from "./client";

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export async function listInstallationRepositories(client: GitHubClient): Promise<RepoInfo[]> {
  const result = await client.request<{ repositories: Array<{ full_name: string; default_branch: string; private: boolean }> }>("GET", "/installation/repositories?per_page=100");
  return result.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private }));
}

export const SNAPSHOT_LIMITS = { maxFileBytes: 100_000, maxTotalBytes: 2_000_000, maxFiles: 300 } as const;

const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.next|\.git|coverage|__pycache__|\.venv)(\/|$)/;
const SECRET_PATH = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_rsa|id_ed25519|credentials(\.json)?|\.npmrc|\.pypirc|secrets?\.(ya?ml|json))$/i;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|tgz|jar|class|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|avi|wasm|bin|lock\.b)$/i;
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

/** A path a snapshot or a repository context may read: no build output, dependencies, secret-looking or binary files. */
export function isReadablePath(path: string): boolean {
  return !SKIP_PATH.test(path) && !SECRET_PATH.test(path) && !BINARY_EXT.test(path);
}

/** True if the content looks like it contains credentials; such files are never sent to models. */
export function containsSecret(content: string): boolean {
  return SECRET_CONTENT.some((pattern) => pattern.test(content));
}

export interface SnapshotFile {
  path: string;
  content: string;
  /** Git file mode, e.g. 100644 or 100755 (executable). */
  mode: string;
}

export interface Snapshot {
  commitSha: string;
  files: SnapshotFile[];
  skipped: Array<{ path: string; reason: string }>;
}

/** Reads a text snapshot of the default branch, filtering build output, binaries and secrets. */
export async function readSnapshot(client: GitHubClient, repo: RepoInfo): Promise<Snapshot> {
  const ref = await client.request<{ object: { sha: string } }>("GET", `/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`);
  const commit = await client.request<{ tree: { sha: string } }>("GET", `/repos/${repo.fullName}/git/commits/${ref.object.sha}`);
  const tree = await client.request<{ tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>; truncated: boolean }>("GET", `/repos/${repo.fullName}/git/trees/${commit.tree.sha}?recursive=1`);
  const files: SnapshotFile[] = [];
  const skipped: Snapshot["skipped"] = [];
  let total = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const reason = SKIP_PATH.test(entry.path)
      ? "build output or dependencies"
      : SECRET_PATH.test(entry.path)
        ? "possible secret file"
        : BINARY_EXT.test(entry.path)
          ? "binary"
          : (entry.size ?? 0) > SNAPSHOT_LIMITS.maxFileBytes
            ? "too large"
            : files.length >= SNAPSHOT_LIMITS.maxFiles || total + (entry.size ?? 0) > SNAPSHOT_LIMITS.maxTotalBytes
              ? "snapshot limit reached"
              : null;
    if (reason) {
      skipped.push({ path: entry.path, reason });
      continue;
    }
    const blob = await client.request<{ content: string; encoding: string }>("GET", `/repos/${repo.fullName}/git/blobs/${entry.sha}`);
    const buffer = Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8");
    if (buffer.includes(0)) {
      skipped.push({ path: entry.path, reason: "binary" });
      continue;
    }
    const content = buffer.toString("utf8");
    if (containsSecret(content)) {
      skipped.push({ path: entry.path, reason: "contains a credential-like value" });
      continue;
    }
    total += buffer.length;
    files.push({ path: entry.path, content, mode: entry.mode });
  }
  if (tree.truncated) skipped.push({ path: "(tree)", reason: "repository tree truncated by GitHub" });
  return { commitSha: ref.object.sha, files, skipped };
}

export interface PullRequestInput {
  baseBranch: string;
  baseSha: string;
  branch: string;
  title: string;
  body: string;
  changes: Array<{ path: string; content: string | null; mode?: string }>;
}

/**
 * Commits the change set on a new branch via the Git Data API and opens a DRAFT pull request.
 * Never pushes to the base branch and never merges.
 */
export async function createDraftPullRequest(client: GitHubClient, repo: RepoInfo, input: PullRequestInput) {
  if (input.branch === input.baseBranch) throw new Error("Refusing to write to the base branch");
  const baseCommit = await client.request<{ tree: { sha: string } }>("GET", `/repos/${repo.fullName}/git/commits/${input.baseSha}`);
  const tree = await client.request<{ sha: string }>("POST", `/repos/${repo.fullName}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: input.changes.map((c) => (c.content === null ? { path: c.path, mode: c.mode ?? "100644", type: "blob", sha: null } : { path: c.path, mode: c.mode ?? "100644", type: "blob", content: c.content })),
  });
  const commit = await client.request<{ sha: string }>("POST", `/repos/${repo.fullName}/git/commits`, { message: input.title, tree: tree.sha, parents: [input.baseSha] });
  await client.request("POST", `/repos/${repo.fullName}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: commit.sha });
  const pr = await client.request<{ number: number; html_url: string }>("POST", `/repos/${repo.fullName}/pulls`, { title: input.title, head: input.branch, base: input.baseBranch, body: input.body, draft: true });
  return { number: pr.number, url: pr.html_url, commitSha: commit.sha };
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  author: string | null;
  headBranch: string;
  baseBranch: string;
  headSha: string;
  url: string;
  updatedAt: string;
}

type RawPull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft?: boolean;
  merged_at: string | null;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  updated_at: string;
};

const summary = (p: RawPull): PullRequestSummary => ({
  number: p.number,
  title: p.title,
  state: p.state,
  draft: Boolean(p.draft),
  merged: p.merged_at !== null,
  author: p.user?.login ?? null,
  headBranch: p.head.ref,
  baseBranch: p.base.ref,
  headSha: p.head.sha,
  url: p.html_url,
  updatedAt: p.updated_at,
});

/** Existing pull requests of a repository (most recently updated first), read-only (#18). */
export async function listPullRequests(client: GitHubClient, repo: RepoInfo, state: "open" | "closed" | "all" = "open"): Promise<PullRequestSummary[]> {
  const pulls = await client.request<RawPull[]>("GET", `/repos/${repo.fullName}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`);
  return pulls.map(summary);
}

/** Longest diff kept per file; larger patches are summarised by their line counts only. */
export const PULL_PATCH_LIMIT = 20_000;

export interface PullRequestFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff, or null when withheld (secret-looking path or content, binary, too large). */
  patch: string | null;
  withheld?: string;
}

/**
 * One pull request with its changed files. Diffs pass the same secret filters as repository snapshots: a file
 * that looks like a credential store or whose diff contains a credential-like value is listed without its patch.
 */
export async function readPullRequest(client: GitHubClient, repo: RepoInfo, number: number) {
  const pull = await client.request<RawPull & { body: string | null; mergeable_state?: string }>("GET", `/repos/${repo.fullName}/pulls/${number}`);
  const raw = await client.request<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>>("GET", `/repos/${repo.fullName}/pulls/${number}/files?per_page=100`);
  const files: PullRequestFile[] = raw.map((f) => {
    const base = { path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions };
    if (SECRET_PATH.test(f.filename)) return { ...base, patch: null, withheld: "possible secret file" };
    if (f.patch === undefined) return { ...base, patch: null, withheld: "binary or no textual diff" };
    if (f.patch.length > PULL_PATCH_LIMIT) return { ...base, patch: null, withheld: "diff too large" };
    if (containsSecret(f.patch)) return { ...base, patch: null, withheld: "contains a credential-like value" };
    return { ...base, patch: f.patch };
  });
  return { ...summary(pull), body: pull.body ?? "", files };
}

export async function checkRuns(client: GitHubClient, repo: RepoInfo, sha: string) {
  const result = await client.request<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string }> }>("GET", `/repos/${repo.fullName}/commits/${sha}/check-runs?per_page=50`);
  return result.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url }));
}
