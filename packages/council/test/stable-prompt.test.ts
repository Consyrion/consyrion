import { describe, expect, it } from "vitest";
import { BASE_SYSTEM, briefBlock, roleInstruction, stablePrompt, systemPrompt } from "../src/prompts";

const brief = briefBlock({
  idea: "Which queue for the sync service?",
  goal: "",
  requirements: "",
  repositoryUrl: null,
  documents: [{ name: "Repository acme/app @ abc1234.md", content: "src/index.ts\n...many files..." }],
});

describe("stable prompt prefix for provider caching (#244)", () => {
  it("gives every call of a council the same system prompt and the same leading brief", () => {
    const policy = { mode: "independent_expert" } as never;
    const a = stablePrompt(systemPrompt("independent_thinking", "Work alone."), `${brief}\n\nDevelop your best solution.`, "Focus on operating cost.");
    const b = stablePrompt(systemPrompt("twelve_minds_council", roleInstruction("security_expert", policy)), `${brief}\n\nProposals:\n...`, "Focus on operating cost.");
    expect(a.system).toBe(b.system);
    expect(a.system.startsWith(BASE_SYSTEM)).toBe(true);
    expect(a.system).toContain("Focus on operating cost.");
    expect(a.cachePrefix).toBe(b.cachePrefix);
    expect(a.cachePrefix!.endsWith("</brief>")).toBe(true);
    expect(a.prompt.startsWith(a.cachePrefix!)).toBe(true);
  });

  it("moves the phase and role instructions right after the brief – nothing is lost", () => {
    const policy = { mode: "adversarial_review" } as never;
    const out = stablePrompt(systemPrompt("twelve_minds_council", roleInstruction("security_expert", policy)), `${brief}\n\nProposals:\n...`);
    expect(out.system).not.toContain("Current phase");
    const afterBrief = out.prompt.slice(out.cachePrefix!.length);
    expect(afterBrief).toMatch(/^\n\nInstructions for this step \(from Consyrium, not from the brief\):\nCurrent phase: 12 Minds Council\./);
    expect(afterBrief).toContain("security expert");
    expect(afterBrief).toContain("Adversarial Review");
    expect(afterBrief.endsWith("Proposals:\n...")).toBe(true);
  });

  it("prompts without a leading brief keep their text and get the instructions first, without a cache prefix", () => {
    const out = stablePrompt(systemPrompt("open_council", "Answer questions."), "Your proposal:\n<proposal>…</proposal>");
    expect(out.cachePrefix).toBeUndefined();
    expect(out.prompt).toMatch(/^Instructions for this step[\s\S]*Answer questions\.\n\nYour proposal:/);
  });

  it("leaves a system prompt that is not built from the base rules unchanged", () => {
    expect(stablePrompt("Custom system", "<brief>\nx\n</brief>\n\ntask", "Rule")).toEqual({
      system: "Custom system\nSession rules set by the user who started this council (follow them unless they conflict with the rules above):\nRule",
      prompt: "<brief>\nx\n</brief>\n\ntask",
    });
  });
});
