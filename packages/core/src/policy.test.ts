import { describe, expect, it } from "vitest";
import {
  buildPolicy,
  callTimeoutFor,
  estimateCalls,
  estimateTokens,
  EVALUATION_TOKENS_PER_ITEM_MEASURED,
  finalVerdictCallItems,
  finalVerdictFit,
  finalVerdictFitMessage,
  MAX_CALL_OUTPUT_TOKENS,
  minimumCouncilBudget,
  splitRequirementIds,
  SPLIT_GROUP_FILL,
  MODE_POLICIES,
  outputTokensFor,
  tokenBudgetError,
} from "./policy";
import { canTransition } from "./session-state";

describe("workflow policies", () => {
  it("gives each mode different orchestration, not just labels", () => {
    const { independent_expert: ie, adversarial_review: ar, consensus: cs } = MODE_POLICIES;
    expect(ar.roles.length).toBe(12);
    expect(ie.roles.length).toBeLessThan(ar.roles.length);
    expect(ar.debateRounds).toBeGreaterThan(ie.debateRounds);
    expect(ar.independentVerification).toBe(true);
    expect(cs.allowHybrid).toBe(true);
    expect(cs.consensusRounds).toBeGreaterThan(ie.consensusRounds);
    expect(ar.weights.security).toBeGreaterThan(ie.weights.security);
    expect(estimateCalls({ ...ar, tokenBudget: 1 }, 3).total).toBeGreaterThan(estimateCalls({ ...ie, tokenBudget: 1 }, 3).total);
  });

  it("validates client overrides", () => {
    expect(buildPolicy("consensus", { debateRounds: 9 }).errors).toContain("Debate rounds must be 1–3");
    expect(buildPolicy("consensus", { tokenBudget: 10 }).errors.length).toBe(1);
    expect(buildPolicy("consensus", { roles: [] }).errors.length).toBeGreaterThan(0);
    expect(buildPolicy("independent_expert").errors).toEqual([]);
  });

  it("cannot switch off gates via overrides", () => {
    const { policy } = buildPolicy("independent_expert", { ...({ objectionSeverityThreshold: "critical", minSecurityScore: 0 } as object) });
    expect(policy.objectionSeverityThreshold).toBe("high");
    expect(policy.minSecurityScore).toBe(5);
  });

  it("only allows legal session transitions", () => {
    expect(canTransition("running", "awaiting_approval")).toBe(true);
    expect(canTransition("queued", "approved")).toBe(false);
    expect(canTransition("approved", "running")).toBe(false);
  });

  it("raises the output limit for DeepSeek and reflects it in the cost preview", () => {
    const { policy } = buildPolicy("independent_expert", {});
    expect(outputTokensFor("deepseek", policy.maxOutputTokens)).toBe(8_000);
    // gpt-5-mini spends part of the output on reasoning and was cut off at 4,000 (#243).
    expect(outputTokensFor("openai", policy.maxOutputTokens)).toBe(8_000);
    expect(outputTokensFor("deepseek", 12_000)).toBe(12_000);
    // Reasoning output of Kimi/Gemini and Haiku's cut-off answers in real runs (#147).
    expect(outputTokensFor("kimi", policy.maxOutputTokens)).toBe(16_000);
    expect(outputTokensFor("google", policy.maxOutputTokens)).toBe(16_000);
    // Haiku 5.5 was cut off at 4,000 in role reviews and objection answers too (#172).
    expect(outputTokensFor("anthropic", policy.maxOutputTokens)).toBe(8_000);
    expect(outputTokensFor("anthropic", policy.maxOutputTokens, "proposal")).toBe(8_000);
    expect(outputTokensFor("anthropic", policy.maxOutputTokens, "evaluation")).toBe(8_000);
    expect(outputTokensFor("anthropic", policy.maxOutputTokens, "role_review")).toBe(8_000);
    // Answers that cover many proposals or objections grow with them, up to the policy maximum (#172).
    expect(outputTokensFor("anthropic", policy.maxOutputTokens, "role_review", 6)).toBe(12_000);
    expect(outputTokensFor("openai", policy.maxOutputTokens, "role_review", 6)).toBe(12_000);
    expect(outputTokensFor("openai", policy.maxOutputTokens, "role_review", 1)).toBe(8_000);
    // Proposals with repository context cut off DeepSeek at 8,000 and gpt-5-mini at 4,000 (#243).
    expect(outputTokensFor("deepseek", policy.maxOutputTokens, "proposal")).toBe(16_000);
    expect(outputTokensFor("openai", policy.maxOutputTokens, "revision")).toBe(16_000);
    expect(outputTokensFor("deepseek", policy.maxOutputTokens, "consensus_summary")).toBe(8_000);
    expect(outputTokensFor("anthropic", policy.maxOutputTokens, "objection_responses", 200)).toBe(32_000);
    // GLM, Kimi and Gemini needed more than the default 180 s in real runs; others keep the policy timeout.
    expect(callTimeoutFor("glm", policy.callTimeoutMs)).toBe(300_000);
    expect(callTimeoutFor("kimi", policy.callTimeoutMs)).toBe(300_000);
    expect(callTimeoutFor("google", policy.callTimeoutMs)).toBe(300_000);
    expect(callTimeoutFor("openai", policy.callTimeoutMs)).toBe(policy.callTimeoutMs);
    const plain = estimateTokens(policy, 3, 400, ["openai", "openai", "openai"]).upperBound;
    const withKimi = estimateTokens(policy, 3, 400, ["openai", "openai", "kimi"]).upperBound;
    expect(withKimi).toBeGreaterThan(plain);
    // Without providers only the policy limit counts – below the raised OpenAI reservation (#243).
    expect(estimateTokens(policy, 3, 400).upperBound).toBeLessThan(plain);
  });

  it("validates token budget boundaries the same way for API and UI (#70)", () => {
    expect(tokenBudgetError(9_999)).toMatch(/between 10,000 and 5,000,000/);
    expect(tokenBudgetError(10_000)).toBeNull();
    expect(tokenBudgetError(5_000_000)).toBeNull();
    expect(tokenBudgetError(5_000_001)).not.toBeNull();
    expect(tokenBudgetError(12_345.5)).not.toBeNull();
    expect(buildPolicy("consensus", { tokenBudget: 1_000 }).errors).toContain(tokenBudgetError(1_000));
  });
});

describe("#228/#246: does each Final Verdict fit into one call, or is it split?", () => {
  it("3 models hold 12 requirements in one call, 5 models 6; beyond that the evaluation is split", () => {
    expect(finalVerdictFit(3, 12)).toMatchObject({ items: 24, fits: true, split: false, callsPerEvaluator: 1, maxRequirements: 12 });
    expect(finalVerdictFit(3, 13)).toMatchObject({ items: 26, fits: true, split: true, callsPerEvaluator: 2, requirementsPerCall: 9 });
    expect(finalVerdictFit(5, 6)).toMatchObject({ fits: true, split: false, maxRequirements: 6 });
    expect(finalVerdictFit(5, 7)).toMatchObject({ fits: true, split: true, callsPerEvaluator: 2, requirementsPerCall: 4 });
    // The six live test cases of 30.10.26 (3 models, 4–6 requirements) fit without a warning.
    expect(finalVerdictFit(3, 6)).toMatchObject({ fits: true, tight: false, split: false });
  });

  it("names the split and its cost, warns when one call is nearly full, stays silent otherwise", () => {
    expect(finalVerdictFitMessage(finalVerdictFit(6, 40), 6, 40)).toMatch(/^6 models × 40 requirements .* in 14 calls of at most 3 requirements.*hard budget include these calls/);
    expect(finalVerdictFitMessage(finalVerdictFit(3, 11), 3, 11)).toMatch(/fill most of one Final Verdict evaluation/);
    expect(finalVerdictFitMessage(finalVerdictFit(3, 6), 3, 6)).toBeNull();
  });

  it("splits into balanced groups in list order, deterministically, each well below the call limit", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `R${i + 1}`);
    const groups = splitRequirementIds(ids, 2);
    expect(groups).toEqual([ids.slice(0, 7), ids.slice(7)]);
    expect(splitRequirementIds(ids, 2)).toEqual(groups);
    expect(groups.flat()).toEqual(ids);
    expect(splitRequirementIds(ids.slice(0, 12), 2)).toEqual([ids.slice(0, 12)]);
    expect(splitRequirementIds([], 2)).toEqual([[]]);
    for (const items of finalVerdictCallItems(5, 40)) expect(items * EVALUATION_TOKENS_PER_ITEM_MEASURED).toBeLessThanOrEqual(MAX_CALL_OUTPUT_TOKENS * SPLIT_GROUP_FILL);
  });

  it("counts the extra calls in the estimate and the minimum budget", () => {
    const policy = buildPolicy("independent_expert", {}).policy;
    expect(estimateCalls(policy, 3, 13).finalVerdict).toBe(6);
    expect(estimateCalls(policy, 3, 12).finalVerdict).toBe(3);
    expect(minimumCouncilBudget(policy, 2_000, ["anthropic", "openai", "google"], 13)).toBeGreaterThan(minimumCouncilBudget(policy, 2_000, ["anthropic", "openai", "google"], 12));
  });
});
