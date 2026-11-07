import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every dropdown uses the styled `Select` from components/ui/select.tsx, never a native `<select>` (grey OS menu that
 * ignores the design – the assistant's model list showed one on 06.11.26). This test fails on any native select.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("Dropdowns", () => {
  it("never use a native <select>", () => {
    const offenders = files(join(__dirname, "..")).filter((file) => !file.endsWith(join("ui", "select.tsx")) && /<select[\s>]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
