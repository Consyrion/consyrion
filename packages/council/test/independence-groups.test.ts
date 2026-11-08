/**
 * User decision 08.11.26: the same model may join through different keys, but its instances are ONE voice. Unit level
 * here (majority, groups); the gate side is covered in the engine tests, the verdict side in core verdict tests.
 */
import { describe, expect, it } from "vitest";
import { modelMajority } from "../src";
import { groupsOf } from "../src/independence";

const participants = [
  { id: "o1", provider: "anthropic", modelId: "claude-opus-5-5" },
  { id: "o2", provider: "anthropic", modelId: "claude-opus-5-5-20261001" },
  { id: "o3", provider: "anthropic", modelId: "Claude-Opus-5-5" },
  { id: "g", provider: "openai", modelId: "gpt-5.4" },
  { id: "x", provider: "google", modelId: "gemini-3.6-flash" },
];

describe("instances of one model are one voice", () => {
  it("groups the Opus instances, keeps the other models apart", () => {
    const groups = groupsOf(participants);
    expect(new Set([groups.o1, groups.o2, groups.o3]).size).toBe(1);
    expect(new Set(Object.values(groups)).size).toBe(3);
  });

  it("three Opus preferences for A do not outvote GPT and Gemini preferring B", () => {
    const prefs = [
      { participantId: "o1", targetProposalId: "A" },
      { participantId: "o2", targetProposalId: "A" },
      { participantId: "o3", targetProposalId: "A" },
      { participantId: "g", targetProposalId: "B" },
      { participantId: "x", targetProposalId: "B" },
    ];
    const grouped = modelMajority(prefs, groupsOf(participants));
    expect(grouped.favored).toBe("B");
    expect(grouped.independentModels).toBe(3);
    // Without groups (the behaviour before) Opus would win 3 : 2.
    expect(modelMajority(prefs).favored).toBe("A");
  });
});
