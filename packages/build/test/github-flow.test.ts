import { generateKeyPairSync, randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import { createSession, runSession, submitApproval } from "@consyrion/council";
import { createCredential, createDatabase, createProject, ensurePersonalOrganization, linkRepository, resolveActor, schema, type ActorContext, type DatabaseHandle, setSubscriptionPlan } from "@consyrion/db";
import type { FetchLike } from "@consyrion/github";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPullRequestForPlan, exportPatch, getExecutionView, runExecution, startExecution, type RepositoryAccess, type Sandbox } from "../src";
import { ScriptedAdapter } from "../../council/test/scripted-adapter";
import { ScriptedEngineer } from "./scripted-engineer";
import { confirmProposedRequirements } from "../../council/test/confirm-requirements";

let handle: DatabaseHandle;
let actor: ActorContext;
let projectId: string;
let credentialId: string;
const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const config = { appId: "1", privateKey, slug: "consyrion-test", clientId: "c", clientSecret: "s", webhookSecret: "w" };

const passing: Sandbox = { name: "fake", available: async () => true, run: async () => ({ status: "passed", exitCode: 0, output: "ok", durationMs: 1 }) };
/** TEST DOUBLE repository: a small existing codebase. */
const repository: RepositoryAccess = {
  snapshot: async () => ({
    commitSha: "base123",
    files: [
      { path: "README.md", content: "# Calc\n", mode: "100644" },
      { path: "scripts/run.sh", content: "echo run\n", mode: "100755" },
    ],
    skipped: [{ path: ".env", reason: "possible secret file" }],
  }),
};

beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u1", name: "Owner", email: "o@example.test" });
  const org = await ensurePersonalOrganization(handle.db, "u1", "Owner");
  actor = await resolveActor(handle.db, "u1", org.id);
  // Plan limits are tested separately; these tests use the largest plan.
  await setSubscriptionPlan(handle.db, "u1", org.id, "business");
  projectId = (await createProject(handle.db, actor, { name: "Calc", type: "repository", brief: { idea: "Add a sum function with tests to the existing calculator repository." } })).id;
  credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-test-0000000000000000" })).id;
  await confirmProposedRequirements(handle.db, actor, projectId);
  await handle.db.insert(schema.githubIntegration).values({ id: "ghi_1", organizationId: org.id, installationId: 42, accountLogin: "acme", accountType: "Organization", repositorySelection: "selected", createdById: "u1" });
  await linkRepository(handle.db, actor, projectId, { integrationId: "ghi_1", fullName: "acme/calc", defaultBranch: "main" });
});

afterEach(async () => {
  await handle.close();
});

async function approvedPlan() {
  const engineer = new ScriptedEngineer(new ScriptedAdapter({ title: "Library", score: () => 8 }));
  const other = new ScriptedEngineer(new ScriptedAdapter({ title: "Service", score: () => 6 }));
  // A third model: with fewer than two independent evaluators per proposal the engine never recommends (#249).
  const third = new ScriptedEngineer(new ScriptedAdapter({ title: "Monolith", score: () => 6 }));
  const resolveAdapter = async (p: { modelId: string }) => (p.modelId === "m1" ? engineer : p.modelId === "m2" ? other : third);
  const { id: sessionId } = await createSession(handle.db, actor, projectId, {
    mode: "independent_expert",
    tokenBudget: 1_000_000,
    participants: [
      { credentialId, modelId: "m1" },
      { credentialId, modelId: "m2" },
      { credentialId, modelId: "m3" },
    ],
  });
  await runSession({ db: handle.db, resolveAdapter, random: () => 0.5 }, sessionId);
  const view = await handle.db.select().from(schema.finalDecision).where(eq(schema.finalDecision.sessionId, sessionId));
  if (view[0]!.outcome === "recommended") await submitApproval(handle.db, actor, sessionId, { action: "approve" });
  else await submitApproval(handle.db, actor, sessionId, { action: "select_alternative", selectedProposalId: view[0]!.recommendedProposalId ?? (await handle.db.select().from(schema.proposal).where(eq(schema.proposal.sessionId, sessionId)))[0]!.id, comment: "test" });
  const { id } = await startExecution(handle.db, actor, sessionId, { requirePlanApproval: false });
  return { id, resolveAdapter };
}

describe("Execution Council on a linked repository", () => {
  it("starts from the repository snapshot and publishes only the changes as a draft PR", async () => {
    const { id, resolveAdapter } = await approvedPlan();
    await runExecution({ db: handle.db, resolveAdapter, sandbox: passing, repository }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("completed");
    expect(view.plan.baseCommitSha).toBe("base123");
    expect(view.plan.snapshotSkipped).toEqual([{ path: ".env", reason: "possible secret file" }]);
    expect(view.files.find((f) => f.path === "README.md")).toMatchObject({ changed: false });
    expect(view.files.find((f) => f.path === "src/sum.js")).toMatchObject({ changed: true });

    const patch = await exportPatch(handle.db, actor, id);
    expect(patch).toContain("new file mode 100644");
    expect(patch).toContain("+++ b/src/sum.js");
    expect(patch).not.toContain("README.md");

    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = new URL(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init?.method ?? "GET", path: url.pathname, body });
      const routes: Record<string, unknown> = {
        "POST /app/installations/42/access_tokens": { token: "inst-token" },
        "GET /repos/acme/calc/git/commits/base123": { tree: { sha: "tree0" } },
        "POST /repos/acme/calc/git/trees": { sha: "tree1" },
        "POST /repos/acme/calc/git/commits": { sha: "commit1" },
        "POST /repos/acme/calc/git/refs": {},
        "POST /repos/acme/calc/pulls": { number: 9, html_url: "https://github.com/acme/calc/pull/9" },
      };
      const result = routes[`${init?.method ?? "GET"} ${url.pathname}`];
      return result === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(result), { status: 200 });
    };
    const pr = await createPullRequestForPlan(handle.db, actor, id, { config, fetchImpl });
    expect(pr).toEqual({ number: 9, url: "https://github.com/acme/calc/pull/9" });
    expect(calls[0]).toMatchObject({ path: "/app/installations/42/access_tokens", body: { repositories: ["calc"], permissions: { contents: "write", pull_requests: "write" } } });
    const tree = calls.find((c) => c.path.endsWith("/git/trees"))!.body as { tree: Array<{ path: string }> };
    expect(tree.tree.map((t) => t.path).sort()).toEqual(["package.json", "src/sum.js"]);
    expect(calls.find((c) => c.path.endsWith("/pulls"))!.body).toMatchObject({ draft: true, head: `consyrion/${id}`, base: "main" });
    // Idempotent: a second click does not create another PR.
    expect(await createPullRequestForPlan(handle.db, actor, id, { config, fetchImpl })).toEqual(pr);
    expect(calls.filter((c) => c.path.endsWith("/pulls"))).toHaveLength(1);
  });

  it("blocks the draft PR when tests fail unless an owner gives a reason (quality gate)", async () => {
    const failing: Sandbox = { name: "fake", available: async () => true, run: async () => ({ status: "failed", exitCode: 1, output: "1 failing", durationMs: 1 }) };
    const { id, resolveAdapter } = await approvedPlan();
    await runExecution({ db: handle.db, resolveAdapter, sandbox: failing, repository }, id);
    const failedView = await getExecutionView(handle.db, actor, id);
    expect(failedView.plan.status).toBe("completed");
    const bodies: unknown[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/pulls")) bodies.push(JSON.parse(String(init?.body)));
      const routes: Record<string, unknown> = {
        "POST /app/installations/42/access_tokens": { token: "inst-token" },
        "GET /repos/acme/calc/git/commits/base123": { tree: { sha: "tree0" } },
        "POST /repos/acme/calc/git/trees": { sha: "tree1" },
        "POST /repos/acme/calc/git/commits": { sha: "commit1" },
        "POST /repos/acme/calc/git/refs": {},
        "POST /repos/acme/calc/pulls": { number: 10, html_url: "https://github.com/acme/calc/pull/10" },
      };
      const result = routes[`${init?.method ?? "GET"} ${url.pathname}`];
      return result === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(result), { status: 200 });
    };
    await expect(createPullRequestForPlan(handle.db, actor, id, { config, fetchImpl })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Quality gate") });
    await expect(createPullRequestForPlan(handle.db, actor, id, { config, fetchImpl }, { overrideReason: "too short" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(bodies).toHaveLength(0);
    const pr = await createPullRequestForPlan(handle.db, actor, id, { config, fetchImpl }, { overrideReason: "Flaky test, verified manually in staging" });
    expect(pr.number).toBe(10);
    expect((bodies[0] as { body: string }).body).toContain("Quality gate overridden");
    const [audit] = await handle.db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, "github.pull_request_created"));
    expect(audit!.metadata).toMatchObject({ qualityGateOverride: "Flaky test, verified manually in staging" });
  });

  it("fails clearly when GitHub access is not configured on the worker", async () => {
    const { id, resolveAdapter } = await approvedPlan();
    await runExecution({ db: handle.db, resolveAdapter, sandbox: passing }, id);
    const view = await getExecutionView(handle.db, actor, id);
    expect(view.plan.status).toBe("failed");
    expect(view.plan.error).toMatch(/GitHub access is not configured/);
  });

  it("refuses to publish an unfinished run", async () => {
    const { id } = await approvedPlan();
    await expect(createPullRequestForPlan(handle.db, actor, id, { config })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
