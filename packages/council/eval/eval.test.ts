import { describe, expect, it } from "vitest";
import { GOLDEN_CASES } from "./cases";
import { runCase } from "./run";

describe("golden cases (#33)", () => {
  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))("%s", async (_id, golden) => {
    const result = await runCase(golden);
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(0);
  }, 60_000);
});
