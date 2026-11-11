import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Live test 08.11.2026: the profile publish route did not pass the platform-admin gate exception (#566), so the owner
 * could submit skills but not expert profiles. Every route that submits to the SkillHub must pass `{ platformAdmin }`.
 */
describe("SkillHub submission routes", () => {
  it("all pass the platform-admin gate decision to submitSkillForPublication", () => {
    const root = join(__dirname, "..", "..", "app", "api");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "route.ts") {
          const text = readFileSync(path, "utf8");
          for (const call of text.match(/submitSkillForPublication\([^;]*\);/gs) ?? []) if (!/platformAdmin/.test(call)) offenders.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
