import { describe, expect, it } from "vitest";
import { withRevisionNote } from "../src/phases";

describe("short revision notes on objections", () => {
  it("keeps one sentence per kind and lists every revision once", () => {
    let reason = withRevisionNote("Conceded by the author.", "changed", 2);
    reason = withRevisionNote(reason, "changed", 3);
    reason = withRevisionNote(reason, "addressed", 3);
    expect(reason).toBe(
      "Conceded by the author. Addressed by the author in v3. Content changed after the author conceded in v2, v3 (not linked to this objection). Not independently re-reviewed.",
    );
    // Applying the same revision again changes nothing.
    expect(withRevisionNote(reason, "changed", 3)).toBe(reason);
  });

  it("does not grow without limit over many revisions", () => {
    let reason: string | null = null;
    for (let v = 2; v <= 8; v++) reason = withRevisionNote(reason, "changed", v);
    expect(reason!.length).toBeLessThan(140);
  });
});
