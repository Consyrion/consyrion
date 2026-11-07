import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Effects must not return the value of an expression (`useEffect(() => el.scrollIntoView())`): browser extensions
 * patch DOM methods, and React then calls the returned value as a cleanup function. That crashed the assistant panel
 * in production on 06.11.26 ("i is not a function"). Effects use a block body or return a function explicitly.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("React effects", () => {
  it("never return an expression's value", () => {
    const offenders = files(join(__dirname, "..")).filter((file) => /use(Layout)?Effect\(\s*\(\)\s*=>(?!\s*\{)/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
