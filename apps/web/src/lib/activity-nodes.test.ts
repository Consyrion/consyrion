import { describe, expect, it } from "vitest";
import { mergeActivityNodes, sessionActivityNodes, type ActivitySessionView } from "./activity-nodes";

const view = (status: string, overrides: Partial<ActivitySessionView> = {}): ActivitySessionView => ({
  session: { status, currentPhase: "final_verdict" },
  participants: [
    { id: "p1", provider: "anthropic", modelId: "claude-haiku-5-5", status: "active", failureReason: null },
    { id: "p2", provider: "google", modelId: "gemini-2.5-pro", status: "failed", failureReason: "model not found (HTTP 404)" },
  ],
  usage: [
    { participantId: "p1", phase: "independent_thinking", outcome: "ok", calls: 2, inputTokens: 1000, outputTokens: 400 },
    { participantId: "p1", phase: "final_verdict", outcome: "ok", calls: 1, inputTokens: 500, outputTokens: 100 },
    { participantId: "p1", phase: "final_verdict", outcome: "error", calls: 1, inputTokens: 0, outputTokens: 0 },
    { participantId: "p2", phase: "independent_thinking", outcome: "error", calls: 1, inputTokens: 0, outputTokens: 0 },
  ],
  roles: [{ participantId: "p1", role: "security_expert" }],
  ...overrides,
});

describe("council graphic nodes (dashboard and project overview)", () => {
  it("builds one node per participant with real calls, tokens, roles and state", () => {
    const [claude, gemini] = sessionActivityNodes(view("awaiting_approval"));
    expect(claude).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", state: "done" });
    expect(claude!.details).toMatchObject({ calls: 4, failedCalls: 1, inputTokens: 1500, outputTokens: 500, roles: ["Security Expert"] });
    expect(gemini).toMatchObject({ state: "failed", details: { failureReason: "model not found (HTTP 404)" } });
  });

  it("shows models that answered the current phase as done and the others as working while the council runs", () => {
    const nodes = sessionActivityNodes(view("running", { participants: [view("running").participants[0]!] }));
    expect(nodes[0]!.state).toBe("done");
    const waiting = sessionActivityNodes(
      view("running", { session: { status: "running", currentPhase: "open_council" }, participants: [view("running").participants[0]!] }),
    );
    expect(waiting[0]!.state).toBe("working");
    expect(sessionActivityNodes(view("queued"))[0]!.state).toBe("idle");
  });

  it("merges all sessions of a project: each model once, figures summed, failed only when it failed every time", () => {
    const first = sessionActivityNodes(view("approved"));
    const second = sessionActivityNodes(
      view("awaiting_approval", {
        participants: [
          { id: "q1", provider: "anthropic", modelId: "Claude-Haiku-5-5", status: "active", failureReason: null },
          { id: "q2", provider: "openai", modelId: "gpt-5.4-mini", status: "active", failureReason: null },
        ],
        usage: [
          { participantId: "q1", phase: "final_verdict", outcome: "ok", calls: 3, inputTokens: 300, outputTokens: 30 },
          { participantId: "q2", phase: "final_verdict", outcome: "ok", calls: 2, inputTokens: 200, outputTokens: 20 },
        ],
        roles: [{ participantId: "q1", role: "cost_analyst" }],
      }),
    );
    const merged = mergeActivityNodes([first, second]);
    expect(merged.map((n) => n.model)).toEqual(["claude-haiku-5-5", "gemini-2.5-pro", "gpt-5.4-mini"]);
    expect(merged[0]!.details).toMatchObject({ sessions: 2, calls: 7, inputTokens: 1800, outputTokens: 530, roles: ["Security Expert", "Cost Analyst"] });
    expect(merged[0]!.state).toBe("done");
    expect(merged[1]).toMatchObject({ state: "failed", details: { sessions: 1 } });
    expect(merged[2]).toMatchObject({ state: "done", details: { sessions: 1, calls: 2 } });
  });
});
