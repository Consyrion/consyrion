import { describe, expect, it } from "vitest";
import type { View } from "./helpers";
import { participationMatrix, silentIn } from "./participation";

const view = {
  participants: [
    { id: "p1", provider: "openai", modelId: "a" },
    { id: "p2", provider: "openai", modelId: "b" },
  ],
  proposals: [{ authorParticipantId: "p1" }, { authorParticipantId: "p2" }],
  messages: [
    { participantId: "p1", phase: "twelve_minds_council" },
    { participantId: "p1", phase: "twelve_minds_council" },
  ],
  scores: [{ evaluatorParticipantId: "p2" }, { evaluatorParticipantId: "p2" }],
  usage: [
    { participantId: "p1", phase: "twelve_minds_council", outcome: "ok", calls: 1 },
    { participantId: "p2", phase: "twelve_minds_council", outcome: "invalid_output", calls: 2 },
    { participantId: "p2", phase: "final_verdict", outcome: "ok", calls: 1 },
  ],
} as unknown as View;

describe("participation per model and phase (ChatGPT P0)", () => {
  it("counts calls, failures and contributions from stored rows only", () => {
    const [a, b] = participationMatrix(view);
    expect(a!.cells.twelve_minds_council).toEqual({ ok: 1, failed: 0, contributions: 2 });
    expect(b!.cells.twelve_minds_council).toEqual({ ok: 0, failed: 2, contributions: 0 });
    expect(b!.cells.final_verdict).toEqual({ ok: 1, failed: 0, contributions: 2 });
    expect(a!.cells.independent_thinking.contributions).toBe(1);
    // p2 gave no 12 Minds review although the phase ran: shown as silent, not as taking part.
    expect(silentIn(b!, "twelve_minds_council", true)).toBe(true);
    expect(silentIn(a!, "twelve_minds_council", true)).toBe(false);
    expect(silentIn(b!, "minority_review", false)).toBe(false);
  });

  it("marks several instances of one model as one independent voice (user decision 08.11.26)", () => {
    const rows = participationMatrix({
      participants: [
        { id: "k1", provider: "anthropic", modelId: "claude-opus-5-5" },
        { id: "g1", provider: "openai", modelId: "gpt-5" },
        { id: "k2", provider: "anthropic", modelId: "claude-opus-5-5-20261001" },
      ],
      proposals: [],
    } as unknown as View);
    expect(rows.map((r) => r.instance)).toEqual([{ index: 1, total: 2 }, undefined, { index: 2, total: 2 }]);
  });
});
