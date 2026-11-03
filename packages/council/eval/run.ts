/**
 * Runs the golden cases against the real engine (in-memory database, deterministic test models) and
 * returns one result per case. Used by eval/eval.test.ts (CI regression) and `pnpm --filter
 * @consyrion/council eval` (prints a Markdown report).
 */
import { randomBytes } from "node:crypto";
import { keyringFromEnv } from "@consyrion/core";
import { createCredential, createDatabase, createProject, ensurePersonalOrganization, resolveActor, schema, setSubscriptionPlan } from "@consyrion/db";
import { createSession, getSessionView, runSession } from "../src";
import { confirmProposedRequirements } from "../test/confirm-requirements";
import { ScriptedAdapter } from "../test/scripted-adapter";
import { GOLDEN_CASES, type GoldenCase } from "./cases";

export interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; actual: string }>;
  tokens: number;
}

export async function runCase(golden: GoldenCase): Promise<CaseResult> {
  const handle = createDatabase("memory://");
  try {
    await handle.migrate();
    await handle.db.insert(schema.user).values({ id: "eval", name: "Eval", email: "eval@example.test" });
    const org = await ensurePersonalOrganization(handle.db, "eval", "Eval");
    const actor = await resolveActor(handle.db, "eval", org.id);
    await setSubscriptionPlan(handle.db, "eval", org.id, "business");
    const keyring = keyringFromEnv({ CREDENTIALS_MASTER_KEY_V1: randomBytes(32).toString("base64") });
    const projectId = (
      await createProject(handle.db, actor, {
        name: `Eval ${golden.id}`,
        type: "architecture",
        brief: { idea: `Golden case ${golden.id}: ${golden.description}` },
      })
    ).id;
    await confirmProposedRequirements(handle.db, actor, projectId);
    const credentialId = (await createCredential(handle.db, actor, keyring, { provider: "anthropic", secret: "sk-ant-eval-000000000000000000" })).id;
    const adapters = new Map(Object.entries(golden.models).map(([model, script]) => [model, new ScriptedAdapter(script)]));
    const { id } = await createSession(handle.db, actor, projectId, {
      mode: golden.mode,
      participants: Object.keys(golden.models).map((modelId) => ({ credentialId, modelId })),
      confirmBudget: true,
    });
    await runSession({ db: handle.db, resolveAdapter: async (p: { modelId: string }) => adapters.get(p.modelId)!, random: () => 0.5 }, id);
    const view = await getSessionView(handle.db, actor, id);

    const titleOf = (proposalId: string | null | undefined) => {
      const p = view.proposals.find((x) => x.id === proposalId);
      return p ? (p.revisions[0]!.content as { title: string }).title : "–";
    };
    const matrix = view.decision?.matrix as { confidence?: string } | undefined;
    const e = golden.expect;
    const checks: CaseResult["checks"] = [];
    const check = (name: string, passed: boolean, actual: string) => checks.push({ name, passed, actual });
    if (e.outcome) check(`outcome = ${e.outcome}`, view.decision?.outcome === e.outcome, view.decision?.outcome ?? "none");
    if (e.winner) check(`winner = ${e.winner}`, titleOf(view.decision?.recommendedProposalId) === e.winner, titleOf(view.decision?.recommendedProposalId));
    if (e.notWinner)
      check(`winner ≠ ${e.notWinner}`, titleOf(view.decision?.recommendedProposalId) !== e.notWinner, titleOf(view.decision?.recommendedProposalId));
    if (e.confidence) check(`confidence = ${e.confidence}`, matrix?.confidence === e.confidence, matrix?.confidence ?? "none");
    if (e.blockedTitle) {
      const blocked = view.objections.some((o) => o.blocking && titleOf(o.proposalId) === e.blockedTitle);
      check(`blocking objection against ${e.blockedTitle}`, blocked, blocked ? "yes" : "no");
    }
    if (e.failed) {
      const failed = view.participants
        .filter((p) => p.status === "failed")
        .map((p) => p.modelId)
        .sort();
      check(`failed = ${e.failed.join(", ")}`, JSON.stringify(failed) === JSON.stringify([...e.failed].sort()), failed.join(", ") || "none");
    }
    return { id: golden.id, description: golden.description, passed: checks.every((c) => c.passed), checks, tokens: view.session.tokensUsed };
  } finally {
    await handle.close();
  }
}

export async function runGoldenCases(cases = GOLDEN_CASES) {
  const results: CaseResult[] = [];
  for (const golden of cases) results.push(await runCase(golden));
  return results;
}

export function toMarkdown(results: CaseResult[]) {
  const lines = [
    "# Consyrion golden cases",
    "",
    `${results.filter((r) => r.passed).length} / ${results.length} passed`,
    "",
    "| Case | Result | Checks |",
    "|---|---|---|",
  ];
  for (const r of results)
    lines.push(
      `| ${r.id} | ${r.passed ? "pass" : "FAIL"} | ${r.checks.map((c) => `${c.passed ? "✓" : "✗"} ${c.name}${c.passed ? "" : ` (got ${c.actual})`}`).join("<br>")} |`,
    );
  return lines.join("\n");
}
