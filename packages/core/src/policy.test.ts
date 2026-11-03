import { describe, expect, it } from "vitest";
import {
  buildPolicy,
  callTimeoutFor,
  estimateCalls,
  estimateTokens,
  finalVerdictFit,
  finalVerdictFitMessage,
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

describe("#228: does each Final Verdict fit into one call?", () => {
  it("3 models hold 12 requirements, 5 models 6; one more does not fit", () => {
    expect(finalVerdictFit(3, 12)).toMatchObject({ items: 24, fits: true, maxRequirements: 12 });
    expect(finalVerdictFit(3, 13)).toMatchObject({ items: 26, fits: false });
    expect(finalVerdictFit(5, 6)).toMatchObject({ fits: true, maxRequirements: 6 });
    expect(finalVerdictFit(5, 7).fits).toBe(false);
    // The six live test cases of 30.10.26 (3 models, 4–6 requirements) fit without a warning.
    expect(finalVerdictFit(3, 6)).toMatchObject({ fits: true, tight: false });
  });

  it("names the limit and the way out; warns when most of the call is used", () => {
    expect(finalVerdictFitMessage(finalVerdictFit(6, 40), 6, 40)).toMatch(/^6 models × 40 requirements do not fit .* With 6 models use at most 5 requirements/);
    expect(finalVerdictFitMessage(finalVerdictFit(3, 11), 3, 11)).toMatch(/fill most of one Final Verdict evaluation/);
    expect(finalVerdictFitMessage(finalVerdictFit(3, 6), 3, 6)).toBeNull();
  });
});
