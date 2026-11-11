import { describe, expect, it, vi } from "vitest";
import { followSessionStatus } from "./session-status-stream";

function fakeSource() {
  const listeners: Record<string, (e: { data: string }) => void> = {};
  const source = {
    onerror: null as (() => void) | null,
    close: vi.fn(),
    addEventListener: (t: string, l: (e: { data: string }) => void) => void (listeners[t] = l),
  };
  return { source, emit: (t: string, data: unknown) => listeners[t]!({ data: JSON.stringify(data) }) };
}

describe("live council status for the start card (#12, #215)", () => {
  it("follows the usage events and closes the stream when the council ends", () => {
    const { source, emit } = fakeSource();
    const seen: string[] = [];
    const load = vi.fn();
    followSessionStatus("ses_1", (s) => seen.push(`${s.status}/${s.phase}/${s.tokens}`), { createSource: () => source, load });
    emit("usage", { status: "running", phase: "open_council", tokensUsed: 24000 });
    expect(source.close).not.toHaveBeenCalled();
    emit("usage", { status: "awaiting_approval", phase: "final_verdict", tokensUsed: 110805 });
    expect(seen).toEqual(["running/open_council/24000", "awaiting_approval/final_verdict/110805"]);
    expect(source.close).toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("falls back to polling when the stream breaks, and without EventSource", async () => {
    const { source } = fakeSource();
    const statuses = [
      { status: "running", phase: "open_council", tokens: 1 },
      { status: "completed", phase: null, tokens: 2 },
    ];
    const load = vi.fn(async () => statuses.shift()!);
    const waits: Array<() => void> = [];
    const seen: string[] = [];
    followSessionStatus("ses_1", (s) => seen.push(s.status), { createSource: () => source, load, wait: (_ms, run) => waits.push(run) });
    source.onerror!();
    await vi.waitFor(() => expect(seen).toEqual(["running"]));
    waits.shift()!();
    await vi.waitFor(() => expect(seen).toEqual(["running", "completed"]));
    expect(waits).toHaveLength(0); // no more polling once it ended

    const seen2: string[] = [];
    followSessionStatus("ses_2", (s) => seen2.push(s.status), { createSource: null, load: async () => ({ status: "approved", phase: null, tokens: 3 }) });
    await vi.waitFor(() => expect(seen2).toEqual(["approved"]));
  });
});
