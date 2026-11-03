import { describe, expect, it } from "vitest";
import { blockedBy } from "./execution";

describe("blocked tasks (#107)", () => {
  it("names the failed task a waiting task depends on, also indirectly", () => {
    const tasks = [
      { key: "T1", status: "done", dependsOn: [] },
      { key: "T2", status: "failed", dependsOn: ["T1"] },
      { key: "T3", status: "done", dependsOn: ["T1"] },
      { key: "T4", status: "pending", dependsOn: ["T2"] },
      { key: "T5", status: "pending", dependsOn: ["T3", "T4"] },
      { key: "T6", status: "pending", dependsOn: ["T3"] },
    ];
    expect(blockedBy(tasks)).toEqual({ T4: ["T2"], T5: ["T2"] });
  });
});
