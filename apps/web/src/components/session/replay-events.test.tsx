import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/all-messages";
import type { View } from "./helpers";
import { REPLAY_PAGE, ReplayScreen, windowOf } from "./replay";
import { buildReplayEvents, replayEdges, replayState } from "./replay-events";

/** 3 models, gpt drops out before the Final Verdict; two proposals, one critique, one objection, verdict. */
const view = {
  session: { id: "s1", status: "awaiting_approval", currentPhase: "final_verdict" },
  participants: [
    { id: "par_a", provider: "anthropic", modelId: "claude-haiku-5-5", status: "active" },
    { id: "par_b", provider: "openai", modelId: "gpt-5.4-mini", status: "failed", failureReason: "invalid answers" },
    { id: "par_c", provider: "google", modelId: "gemini-3.6-flash", status: "active" },
  ],
  roles: [{ id: "r1", participantId: "par_a", role: "security_expert" }],
  stages: [
    { phase: "independent_thinking", status: "completed", startedAt: "2026-11-08T10:00:00Z", completedAt: "2026-11-08T10:02:00Z" },
    { phase: "open_council", status: "completed", startedAt: "2026-11-08T10:02:00Z", completedAt: "2026-11-08T10:05:00Z" },
    { phase: "twelve_minds_council", status: "completed", startedAt: "2026-11-08T10:05:00Z", completedAt: "2026-11-08T10:08:00Z" },
    { phase: "final_verdict", status: "completed", startedAt: "2026-11-08T10:10:00Z", completedAt: "2026-11-08T10:12:00Z" },
    // A stage row without times (older runs): not in the replay, counted instead.
    { phase: "execution_council", status: "pending", startedAt: null, completedAt: null },
  ],
  proposals: [
    {
      id: "pro_a",
      label: "A",
      authorParticipantId: "par_a",
      revisions: [{ id: "rev_a1", version: 1, phase: "independent_thinking", content: { title: "E-Mail first" }, createdAt: "2026-11-08T10:01:00Z" }],
    },
    {
      id: "pro_b",
      label: "B",
      authorParticipantId: "par_c",
      revisions: [{ id: "rev_b1", version: 1, phase: "independent_thinking", content: { title: "Messenger" }, createdAt: "2026-11-08T10:01:00Z" }],
    },
  ],
  messages: [
    {
      id: "m1",
      phase: "twelve_minds_council",
      round: 1,
      kind: "critique",
      participantId: "par_a",
      role: "security_expert",
      targetProposalId: "pro_b",
      severity: "high",
      category: "security",
      body: "Phone numbers are visible to all members.",
      createdAt: "2026-11-08T10:06:00Z",
    },
  ],
  objections: [
    {
      id: "o1",
      proposalId: "pro_b",
      raisedByParticipantId: "par_a",
      claim: "Phone numbers leak",
      severity: "high",
      category: "security",
      status: "accepted",
      createdAt: "2026-11-08T10:07:00Z",
    },
  ],
  minorityReview: null,
  consensus: null,
  scores: [
    { id: "s1", evaluatorParticipantId: "par_c", createdAt: "2026-11-08T10:11:00Z" },
    { id: "s2", evaluatorParticipantId: "par_c", createdAt: "2026-11-08T10:11:30Z" },
  ],
  votes: [],
  decision: { id: "d1", outcome: "recommended", recommendedProposalId: "pro_a", supersededAt: null, createdAt: "2026-11-08T10:12:00Z" },
  previousDecisions: [],
  approvals: [],
} as unknown as View;

describe("council replay from stored events (#271)", () => {
  it("lists only stored rows, in a stable order: time, then phase start before content and phase end after it", () => {
    const { events, withoutTime } = buildReplayEvents(view);
    expect(withoutTime).toBe(0); // a row without times is simply absent, not counted as an event with a time
    expect(events.map((e) => e.id)).toEqual([
      "stage_started:independent_thinking",
      "revision:rev_a1",
      "revision:rev_b1",
      "stage_completed:independent_thinking",
      "stage_started:open_council",
      "stage_completed:open_council",
      "stage_started:twelve_minds_council",
      "message:m1",
      "objection:o1",
      "stage_completed:twelve_minds_council",
      "stage_started:final_verdict",
      "scores:par_c",
      "decision:d1",
      "stage_completed:final_verdict",
    ]);
    // Same order after a reload (a fresh build from the same rows).
    expect(buildReplayEvents(structuredClone(view)).events.map((e) => e.id)).toEqual(events.map((e) => e.id));
    // Times are exactly the stored ones; scores are grouped per evaluator at its last stored score.
    expect(events.find((e) => e.id === "scores:par_c")).toMatchObject({ at: "2026-11-08T10:11:30.000Z", data: { count: 2 } });
  });

  it("never shows a dropped-out model as active and reveals objection decisions only at the end", () => {
    const { events } = buildReplayEvents(view);
    const atObjection = replayState(
      view,
      events,
      events.findIndex((e) => e.id === "objection:o1"),
    );
    expect(atObjection.failedParticipants).toEqual(["par_b"]);
    expect(atObjection.current).toBe("twelve_minds_council");
    expect(atObjection.phases.final_verdict).toBe("pending");
    expect(atObjection.objectionDecisionsFinal).toBe(false);
    const end = replayState(view, events, events.length - 1);
    expect(end.objectionDecisionsFinal).toBe(true);
    expect(end.phases.final_verdict).toBe("completed");
    expect(end.messages).toBe(1);
  });

  it("renders the replay in German with real times and no invented text, and handles a session with no events", () => {
    const html = (v: View) =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="UTC">
          <ReplayScreen view={v} live={false} />
        </NextIntlClientProvider>,
      );
    const full = html(view);
    expect(full).toContain("Verlauf des Councils");
    expect(full).toContain("Abgeschlossen");
    expect(full).toContain("ausgefallen");
    expect(full).toContain("claude-haiku-5-5: Kritik · zu Vorschlag B");
    expect(full).toContain("Urteil: eine Lösung wird empfohlen");
    expect(full).toContain('dateTime="2026-11-08T10:06:00.000Z"');
    expect(html({ ...view, stages: [], proposals: [], messages: [], objections: [], scores: [], decision: null } as unknown as View)).toContain(
      "Noch keine gespeicherten Ereignisse.",
    );
  });

  it("renders long sessions in a window ending at the cursor (#271 part 2)", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `m${i}`,
      phase: "open_council",
      round: 1,
      kind: "question",
      participantId: "par_a",
      role: null,
      targetProposalId: "pro_b",
      severity: null,
      category: null,
      body: `Question ${i}`,
      createdAt: new Date(Date.UTC(2026, 10, 8, 10, 3, 0) + i * 1000).toISOString(),
    }));
    const long = { ...view, messages: many, objections: [] } as unknown as View;
    const { events } = buildReplayEvents(long);
    const last = events.length - 1;
    const win = windowOf(events, last, REPLAY_PAGE);
    expect(win).toHaveLength(REPLAY_PAGE);
    expect(win.at(-1)!.index).toBe(last);
    expect(windowOf(events, 10, REPLAY_PAGE).map((w) => w.index)).toEqual(Array.from({ length: 11 }, (_, i) => i));
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messagesFor("de")} timeZone="UTC">
        <ReplayScreen view={long} live={false} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(`${events.length - REPLAY_PAGE} frühere Ereignisse sind ausgeblendet.`);
    expect(html.match(/<time /g)).toHaveLength(REPLAY_PAGE);
  });

  it("draws network connections only for stored rows that name a model and a proposal, up to the cursor (#271 part 3)", () => {
    const { events } = buildReplayEvents(view);
    const end = replayEdges(events, events.length - 1);
    expect(end.map((e) => [e.participantId, e.proposalId, e.kind, e.eventIds])).toEqual([
      ["par_a", "pro_b", "critique", ["message:m1"]],
      ["par_a", "pro_b", "objection", ["objection:o1"]],
    ]);
    // Before the critique was stored there is no line at all – nothing is inferred from activity.
    expect(replayEdges(events, events.findIndex((e) => e.id === "message:m1") - 1)).toEqual([]);
    // Scores, votes and the verdict name no proposal pair and never become lines.
    expect(end.some((e) => e.eventIds.some((id) => id.startsWith("scores:") || id.startsWith("decision:")))).toBe(false);
  });

  it("has a table view with one row per stored event and labelled columns (#271 part 4)", async () => {
    const { buildReplayEvents: build } = await import("./replay-events");
    const { events } = build(view);
    const { REPLAY_PAGE: page, windowOf: win } = await import("./replay");
    // The table renders the same window as the timeline.
    expect(win(events, events.length - 1, page).map((w) => w.event.id)).toEqual(events.map((e) => e.id));
    const de = messagesFor("de") as unknown as { replay: { table: Record<string, string>; layout: Record<string, string> } };
    expect(de.replay.layout.table).toBe("Tabelle");
    expect(Object.keys(de.replay.table)).toEqual(["title", "caption", "time", "phase", "event", "model", "proposal"]);
  });
});
