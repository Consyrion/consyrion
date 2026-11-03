import { COUNCIL_PHASE_LABELS, COUNCIL_PHASES } from "@consyrion/core";
import { describe, expect, it } from "vitest";
import { EXAMPLE_QUESTION, STORY_CHAPTERS } from "./story-chapters";
import { blendAt, fillForward, HOLD, progressFromRects } from "./story-timeline";

describe("homepage story chapters (#85)", () => {
  it("tells all seven canonical phases in order, with their exact names", () => {
    const phases = STORY_CHAPTERS.filter((c) => c.phase).map((c) => c.phase);
    expect(phases).toEqual([...COUNCIL_PHASES]);
    for (const chapter of STORY_CHAPTERS) if (chapter.phase) expect(chapter.title).toBe(COUNCIL_PHASE_LABELS[chapter.phase]);
  });

  it("puts preparation first and the human approval gate before the optional build", () => {
    const ids = STORY_CHAPTERS.map((c) => c.id);
    expect(ids.indexOf("prepare")).toBeLessThan(ids.indexOf("independent-thinking"));
    expect(ids.indexOf("final-verdict")).toBeLessThan(ids.indexOf("approval"));
    expect(ids.indexOf("approval")).toBeLessThan(ids.indexOf("build"));
    expect(STORY_CHAPTERS.find((c) => c.id === "build")?.kicker).toMatch(/optional/i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states BYOK and that twelve perspectives are roles, not models", () => {
    const text = STORY_CHAPTERS.map((c) => `${c.text} ${(c.points ?? []).join(" ")}`).join(" ");
    expect(text).toContain("sells no AI credits");
    expect(text).toMatch(/not twelve extra models/);
    expect(text).not.toMatch(/buy (ai )?credits/i);
  });
});

describe("running example (#85 polish)", () => {
  it("follows one example question through preparation, every phase and the approval", () => {
    for (const chapter of STORY_CHAPTERS) if (chapter.phase || chapter.id === "prepare" || chapter.id === "approval") expect(chapter.example, chapter.id).toBeTruthy();
    expect(STORY_CHAPTERS.find((c) => c.id === "prepare")?.example).toContain(EXAMPLE_QUESTION);
    expect(STORY_CHAPTERS.find((c) => c.id === "final-verdict")?.example).toContain("Hybrid A + C");
  });
});

describe("story timeline", () => {
  it("holds a chapter's scene first, then blends into the next", () => {
    expect(blendAt(3, 10)).toEqual({ from: 3, to: 4, t: 0 });
    expect(blendAt(3 + HOLD * 0.9, 10).t).toBe(0);
    expect(blendAt(3.75, 10).t).toBeGreaterThan(0);
    expect(blendAt(3.999, 10).t).toBeCloseTo(1, 2);
    expect(blendAt(10.5, 10)).toEqual({ from: 10, to: 10, t: 0 });
    expect(blendAt(-1, 10)).toEqual({ from: 0, to: 1, t: 0 });
  });

  it("repeats keyframes forward and hides objects before their first key", () => {
    expect(fillForward([undefined, 1, undefined, 3], 5, 0)).toEqual([0, 1, 1, 3, 3]);
  });

  it("maps the chapter under the middle of the viewport to progress, also when scrolling back", () => {
    const rects = (offset: number) => [0, 1, 2].map((i) => ({ top: i * 1000 - offset, height: 1000 }));
    expect(progressFromRects(rects(0), 1000)).toBeCloseTo(0.5);
    expect(progressFromRects(rects(1200), 1000)).toBeCloseTo(1.7);
    expect(progressFromRects(rects(400), 1000)).toBeCloseTo(0.9);
    expect(progressFromRects(rects(-800), 1000)).toBe(0);
    expect(progressFromRects(rects(5000), 1000)).toBe(2);
  });
});
