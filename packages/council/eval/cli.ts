import { runGoldenCases, toMarkdown } from "./run";

const results = await runGoldenCases();
console.log(toMarkdown(results));
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
