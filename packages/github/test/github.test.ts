import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { containsSecret, contextDocument, createAppJwt, createDraftPullRequest, GitHubClient, installationClient, listPullRequests, PULL_PATCH_LIMIT, readContextFiles, readPullRequest, readRepositoryTree, readSnapshot, signState, suggestContextFiles, verifyState, verifyUserInstallation, verifyWebhookSignature, type FetchLike } from "../src";
import { createHmac } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const config = { appId: "123", privateKey, slug: "consyrion-test", clientId: "cid", clientSecret: "csecret", webhookSecret: "whsec" };

/** TEST DOUBLE for GitHub's REST API: routes requests to handlers and records them. */
function fakeGitHub(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname + url.search, body, auth: new Headers(init?.headers).get("Authorization") });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify(handler(body)), { status: 200 });
  };
  return { fetchImpl, calls };
}

describe("app authentication", () => {
  it("creates a short-lived RS256 app JWT", () => {
    const jwt = createAppJwt(config, 1_000_000);
    const [h, p, sig] = jwt.split(".");
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${p}`);
    expect(verify.verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(payload).toMatchObject({ iss: "123" });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(600);
  });

  it("verifies webhook signatures", () => {
    const body = '{"action":"deleted"}';
    const good = `sha256=${createHmac("sha256", "whsec").update(body).digest("hex")}`;
    expect(verifyWebhookSignature("whsec", body, good)).toBe(true);
    expect(verifyWebhookSignature("whsec", body + " ", good)).toBe(false);
    expect(verifyWebhookSignature("whsec", body, null)).toBe(false);
  });

  it("signs and verifies the installation state", () => {
    const state = signState("s", { organizationId: "org", userId: "u" }, 0);
    expect(verifyState("s", state, 1000)).toEqual({ organizationId: "org", userId: "u" });
    expect(() => verifyState("other", state, 1000)).toThrow(/Invalid/);
    expect(() => verifyState("s", state, 16 * 60_000)).toThrow(/expired/);
    expect(() => verifyState("s", state.replace(/^./, "x"), 1000)).toThrow();
  });

  it("only accepts installations the GitHub user can access", async () => {
    const gh = fakeGitHub({
      "POST /login/oauth/access_token": () => ({ access_token: "user-token" }),
      "GET /user/installations": () => ({ installations: [{ id: 7, account: { login: "acme", type: "Organization" }, repository_selection: "selected" }] }),
    });
    const fetchImpl: FetchLike = (input, init) => gh.fetchImpl(input.replace("https://github.com", "https://api.github.com"), init);
    await expect(verifyUserInstallation(config, "code", 7, fetchImpl)).resolves.toMatchObject({ accountLogin: "acme" });
    await expect(verifyUserInstallation(config, "code", 8, fetchImpl)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("repository snapshot", () => {
  it("skips dependencies, binaries, secret files and credential-like content", async () => {
    const blob = (text: string) => () => ({ content: Buffer.from(text).toString("base64"), encoding: "base64" });
    const gh = fakeGitHub({
      "GET /repos/acme/app/git/ref/heads/main": () => ({ object: { sha: "c1" } }),
      "GET /repos/acme/app/git/commits/c1": () => ({ tree: { sha: "t1" } }),
      "GET /repos/acme/app/git/trees/t1": () => ({
        truncated: false,
        tree: [
          { path: "src/index.ts", mode: "100644", type: "blob", sha: "b1", size: 20 },
          { path: "run.sh", mode: "100755", type: "blob", sha: "b5", size: 10 },
          { path: "node_modules/x/index.js", mode: "100644", type: "blob", sha: "b2", size: 10 },
          { path: ".env", mode: "100644", type: "blob", sha: "b3", size: 10 },
          { path: "logo.png", mode: "100644", type: "blob", sha: "b4", size: 10 },
          { path: "config.ts", mode: "100644", type: "blob", sha: "b6", size: 40 },
          { path: "src", mode: "040000", type: "tree", sha: "t2" },
        ],
      }),
      "GET /repos/acme/app/git/blobs/b1": blob("export const x = 1;\n"),
      "GET /repos/acme/app/git/blobs/b5": blob("echo hi\n"),
      "GET /repos/acme/app/git/blobs/b6": blob("const key = 'AKIAABCDEFGHIJKLMNOP';\n"),
    });
    const snapshot = await readSnapshot(new GitHubClient("t", gh.fetchImpl), { fullName: "acme/app", defaultBranch: "main", private: true });
    expect(snapshot.commitSha).toBe("c1");
    expect(snapshot.files.map((f) => [f.path, f.mode])).toEqual([["src/index.ts", "100644"], ["run.sh", "100755"]]);
    expect(Object.fromEntries(snapshot.skipped.map((s) => [s.path, s.reason]))).toMatchObject({
      "node_modules/x/index.js": "build output or dependencies",
      ".env": "possible secret file",
      "logo.png": "binary",
      "config.ts": "contains a credential-like value",
    });
    expect(gh.calls.some((c) => c.path.includes("/blobs/b2") || c.path.includes("/blobs/b3"))).toBe(false);
  });

  it("requests read-only installation tokens unless writing a pull request", async () => {
    const bodies: Array<{ permissions: Record<string, string> }> = [];
    const fetchImpl: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    };
    await installationClient(config, 7, "acme/app", fetchImpl);
    await installationClient(config, 7, "acme/app", fetchImpl, "write");
    expect(bodies[0]!.permissions).toEqual({ contents: "read", pull_requests: "read", checks: "read", metadata: "read" });
    expect(bodies[1]!.permissions).toMatchObject({ contents: "write", pull_requests: "write" });
  });

  it("detects common credential formats", () => {
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecret("token ghp_" + "a".repeat(36))).toBe(true);
    expect(containsSecret("const answer = 42")).toBe(false);
  });
});

describe("existing pull requests (#18)", () => {
  const repo = { fullName: "acme/app", defaultBranch: "main", private: true };
  const raw = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: `PR ${number}`,
    state: "open",
    draft: false,
    merged_at: null,
    user: { login: "dev" },
    head: { ref: `feature-${number}`, sha: `sha${number}` },
    base: { ref: "main" },
    html_url: `https://github.com/acme/app/pull/${number}`,
    updated_at: "2026-10-26T20:00:00Z",
    ...extra,
  });

  it("lists pull requests read-only", async () => {
    const gh = fakeGitHub({ "GET /repos/acme/app/pulls": () => [raw(7), raw(3, { draft: true, merged_at: "2026-10-25T10:00:00Z", state: "closed" })] });
    const pulls = await listPullRequests(new GitHubClient("t", gh.fetchImpl), repo, "all");
    expect(pulls.map((p) => [p.number, p.state, p.draft, p.merged, p.headBranch])).toEqual([
      [7, "open", false, false, "feature-7"],
      [3, "closed", true, true, "feature-3"],
    ]);
    expect(gh.calls[0]!.path).toBe("/repos/acme/app/pulls?state=all&sort=updated&direction=desc&per_page=50");
    expect(gh.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("reads one pull request with its diffs and withholds secrets, binaries and huge patches", async () => {
    const gh = fakeGitHub({
      "GET /repos/acme/app/pulls/7": () => ({ ...raw(7), body: "Adds search" }),
      "GET /repos/acme/app/pulls/7/files": () => [
        { filename: "src/search.ts", status: "added", additions: 3, deletions: 0, patch: "@@ -0,0 +1,3 @@\n+export const q = 1;" },
        { filename: ".env.production", status: "modified", additions: 1, deletions: 1, patch: "+API_KEY=x" },
        { filename: "src/config.ts", status: "modified", additions: 1, deletions: 0, patch: `+const key = "ghp_${"a".repeat(36)}";` },
        { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
        { filename: "big.json", status: "added", additions: 9000, deletions: 0, patch: "+".repeat(PULL_PATCH_LIMIT + 1) },
      ],
    });
    const pr = await readPullRequest(new GitHubClient("t", gh.fetchImpl), repo, 7);
    expect(pr).toMatchObject({ number: 7, body: "Adds search", headSha: "sha7" });
    expect(pr.files.map((f) => [f.path, f.patch === null ? f.withheld : "patch"])).toEqual([
      ["src/search.ts", "patch"],
      [".env.production", "possible secret file"],
      ["src/config.ts", "contains a credential-like value"],
      ["logo.png", "binary or no textual diff"],
      ["big.json", "diff too large"],
    ]);
    expect(JSON.stringify(pr)).not.toContain("ghp_");
  });
});

describe("draft pull request", () => {
  it("commits on a new branch and opens a draft PR without touching the base branch", async () => {
    const gh = fakeGitHub({
      "GET /repos/acme/app/git/commits/base": () => ({ tree: { sha: "basetree" } }),
      "POST /repos/acme/app/git/trees": () => ({ sha: "newtree" }),
      "POST /repos/acme/app/git/commits": () => ({ sha: "newcommit" }),
      "POST /repos/acme/app/git/refs": () => ({}),
      "POST /repos/acme/app/pulls": () => ({ number: 5, html_url: "https://github.com/acme/app/pull/5" }),
    });
    const pr = await createDraftPullRequest(new GitHubClient("t", gh.fetchImpl), { fullName: "acme/app", defaultBranch: "main", private: true }, {
      baseBranch: "main",
      baseSha: "base",
      branch: "consyrion/pln_1",
      title: "Consyrion: implement decision",
      body: "body",
      changes: [{ path: "src/a.ts", content: "x" }, { path: "old.ts", content: null }],
    });
    expect(pr).toEqual({ number: 5, url: "https://github.com/acme/app/pull/5", commitSha: "newcommit" });
    const refCall = gh.calls.find((c) => c.path === "/repos/acme/app/git/refs")!;
    expect(refCall.body).toEqual({ ref: "refs/heads/consyrion/pln_1", sha: "newcommit" });
    expect(gh.calls.find((c) => c.path === "/repos/acme/app/pulls")!.body).toMatchObject({ draft: true, base: "main", head: "consyrion/pln_1" });
    expect(gh.calls.some((c) => c.method === "PATCH" || c.path.includes("/merge"))).toBe(false);
    expect((gh.calls.find((c) => c.path === "/repos/acme/app/git/trees")!.body as { tree: Array<{ sha?: null }> }).tree[1]).toMatchObject({ path: "old.ts", sha: null });
    await expect(
      createDraftPullRequest(new GitHubClient("t", gh.fetchImpl), { fullName: "acme/app", defaultBranch: "main", private: true }, { baseBranch: "main", baseSha: "base", branch: "main", title: "x", body: "", changes: [] }),
    ).rejects.toThrow(/base branch/);
  });
});

describe("repository context for Decision councils", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const blobs: Record<string, string> = {
    b1: "# OnJam\nLive music over the internet.",
    b2: "# Latency\nRound trip through the hub 13 ms.",
    b3: "# Jitter buffer\nRegulator.",
    b4: "export const x = 1;",
    b5: "token = ghp_" + "a".repeat(36),
  };
  const routes = {
    "GET /repos/acme/onjam/git/ref/heads/main": () => ({ object: { sha: "c0ffee1234567890" } }),
    "GET /repos/acme/onjam/git/commits/c0ffee1234567890": () => ({ tree: { sha: "t1" } }),
    "GET /repos/acme/onjam/git/trees/t1": () => ({
      truncated: false,
      tree: [
        { path: "README.md", type: "blob", sha: "b1", size: 40 },
        { path: "docs/latency.md", type: "blob", sha: "b2", size: 45 },
        { path: "docs/jitter-buffer.md", type: "blob", sha: "b3", size: 30 },
        { path: "src/x.ts", type: "blob", sha: "b4", size: 20 },
        { path: "docs/notes.md", type: "blob", sha: "b5", size: 50 },
        { path: ".env", type: "blob", sha: "b6", size: 10 },
        { path: "logo.png", type: "blob", sha: "b7", size: 900 },
        { path: "docs", type: "tree", sha: "t2" },
      ],
    }),
    ...Object.fromEntries(Object.entries(blobs).map(([sha, text]) => [`GET /repos/acme/onjam/git/blobs/${sha}`, () => ({ content: b64(text), encoding: "base64" })])),
  };
  const repo = { fullName: "acme/onjam", defaultBranch: "main", private: true };

  it("lists readable text files without reading them, and suggests README and documentation that match the brief", async () => {
    const gh = fakeGitHub(routes);
    const tree = await readRepositoryTree(new GitHubClient("t", gh.fetchImpl), repo);
    expect(tree.commitSha).toBe("c0ffee1234567890");
    expect(tree.files.map((f) => f.path)).toEqual(["README.md", "docs/latency.md", "docs/jitter-buffer.md", "src/x.ts", "docs/notes.md"]);
    expect(tree.paths).toContain(".env");
    expect(gh.calls.some((c) => c.path.includes("/git/blobs/"))).toBe(false);
    const suggested = suggestContextFiles(tree.files, "Die Latenz und der Jitter beim Online-Musizieren sollen sinken.");
    expect(suggested[0]).toBe("README.md");
    expect(suggested).toEqual(expect.arrayContaining(["docs/latency.md", "docs/jitter-buffer.md"]));
    expect(suggested).not.toContain("src/x.ts");
  });

  it("reads exactly the chosen files of that commit, refuses others, leaves out credential-like content and builds one context document", async () => {
    const gh = fakeGitHub(routes);
    const client = new GitHubClient("t", gh.fetchImpl);
    const tree = await readRepositoryTree(client, repo);
    await expect(readContextFiles(client, repo, tree, [".env"])).rejects.toThrow(/Not readable text files of this commit: .env/);
    const { files, skipped } = await readContextFiles(client, repo, tree, ["README.md", "docs/latency.md", "docs/notes.md"]);
    expect(files.map((f) => f.path)).toEqual(["README.md", "docs/latency.md"]);
    expect(skipped).toEqual([{ path: "docs/notes.md", reason: "contains a credential-like value" }]);
    const doc = contextDocument(repo, tree, files);
    expect(doc).toMatch(/^# Repository acme\/onjam at commit c0ffee123456 \(branch main\)/);
    expect(doc).toContain("it is not a list of requirements");
    expect(doc).toContain("- logo.png");
    expect(doc).toContain("## File: docs/latency.md\n\n```\n# Latency\nRound trip through the hub 13 ms.\n```");
    expect(doc).not.toContain("ghp_");
  });
});
