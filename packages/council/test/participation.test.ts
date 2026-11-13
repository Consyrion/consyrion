import { describe, expect, it } from "vitest";
import { validParticipation } from "../src/participation";

describe("valid participation rate (#182)", () => {
  const participants = [
    { id: "a", status: "active" },
    { id: "b", status: "active" },
    { id: "c", status: "active" },
  ];

  it("counts a model as valid when every phase it was called in has a successful call, retries included", () => {
    const result = validParticipation(participants, [
      { participantId: "a", phase: "independent_thinking", outcome: "ok", calls: 1 },
      { participantId: "a", phase: "open_council", outcome: "ok", calls: 1 },
      // b failed once and succeeded on retry: still valid.
      { participantId: "b", phase: "independent_thinking", outcome: "error", calls: 2 },
      { participantId: "b", phase: "independent_thinking", outcome: "ok", calls: 1 },
      { participantId: "b", phase: "open_council", outcome: "ok", calls: 1 },
      // c never delivered in Open Council.
      { participantId: "c", phase: "independent_thinking", outcome: "ok", calls: 1 },
      { participantId: "c", phase: "open_council", outcome: "error", calls: 3 },
    ]);
    expect(result).toEqual({
      valid: 2,
      total: 3,
      percent: 67,
      shortfalls: [{ participantId: "c", phases: ["Open Council"] }],
      // QA 12.11.26: failed calls are named beside the rate – b's failed attempts count even though its retry succeeded.
      failedCalls: [
        { participantId: "b", phase: "Independent Thinking", calls: 2 },
        { participantId: "c", phase: "Open Council", calls: 3 },
      ],
    });
  });

  it("counts dropped models and models without any call as short, and has no rate before any call", () => {
    const result = validParticipation(
      [...participants.slice(0, 2), { id: "c", status: "failed" }],
      [
        { participantId: "a", phase: "independent_thinking", outcome: "ok", calls: 1 },
        { participantId: "c", phase: "independent_thinking", outcome: "ok", calls: 1 },
      ],
    );
    expect(result.valid).toBe(1);
    expect(result.shortfalls).toEqual([
      { participantId: "b", phases: [] },
      { participantId: "c", phases: [] },
    ]);
    expect(validParticipation(participants, [])).toEqual({ valid: 0, total: 3, percent: null, shortfalls: [] });
  });

  it("Gesamttest 08.11.26: a model never called in the 12 Minds Council (shortened) did not deliver there", () => {
    const result = validParticipation(participants, [
      ...["a", "b", "c"].map((p) => ({ participantId: p, phase: "independent_thinking" as const, outcome: "ok", calls: 1 })),
      { participantId: "c", phase: "twelve_minds_council", outcome: "ok", calls: 1 },
      ...["a", "b", "c"].map((p) => ({ participantId: p, phase: "final_verdict" as const, outcome: "ok", calls: 1 })),
    ]);
    expect(result.valid).toBe(1);
    expect(result.shortfalls).toEqual([
      { participantId: "a", phases: ["12 Minds Council"], notCalled: ["12 Minds Council"] },
      { participantId: "b", phases: ["12 Minds Council"], notCalled: ["12 Minds Council"] },
    ]);
  });
});
