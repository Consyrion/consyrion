import { describe, expect, it } from "vitest";
import { slotsFor } from "./activity-network";

describe("activity network layout", () => {
  it("places one to six models without any two nodes or their texts in each other's way", () => {
    for (let n = 1; n <= 6; n++) {
      const slots = slotsFor(n);
      expect(slots).toHaveLength(n);
      const left = slots.filter((s) => s.label === "left");
      const right = slots.filter((s) => s.label === "right");
      // Alternately left and right, the text always on the outer side of its column.
      expect(left.length - right.length).toBeGreaterThanOrEqual(0);
      expect(left.length - right.length).toBeLessThanOrEqual(1);
      expect(left.every((s) => s.x < 380)).toBe(true);
      expect(right.every((s) => s.x > 380)).toBe(true);
      // Three text lines and the node ring need about 70 units per model in a column.
      for (const column of [left, right]) {
        const ys = column.map((s) => s.y).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(78);
        expect(ys.every((y) => y - 40 >= 0 && y + 40 <= 360)).toBe(true);
      }
    }
  });

  it("shows at most six models and none for an empty council", () => {
    expect(slotsFor(9)).toHaveLength(6);
    expect(slotsFor(0)).toHaveLength(0);
  });
});
