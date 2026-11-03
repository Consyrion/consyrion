/**
 * `pnpm --filter @consyrion/council reference <dir>`: scores every Decision Report JSON in <dir>. File names are
 * `<case id>__<configuration>__<anything>.json`, e.g. `imp-light-speed__A-cheap__run1.json` (#182).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summarize, summaryToMarkdown, type ScoredRun } from "./reference-score";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: reference <directory with <case>__<config>__<run>.json reports>");
  process.exit(2);
}
const runs: ScoredRun[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((file) => {
    const [caseId, config] = file.replace(/\.json$/, "").split("__");
    if (!caseId || !config) throw new Error(`${file}: expected <case>__<config>__<run>.json`);
    return { caseId, config, file, report: JSON.parse(readFileSync(join(dir, file), "utf8")) };
  });
console.log(summaryToMarkdown(summarize(runs)));
