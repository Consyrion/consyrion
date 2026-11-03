#!/usr/bin/env node
/* global process, console */
// Fails when engine logic reaches the browser (#189): scans the client chunks of a production build
// (apps/web/.next/static) for text that only server-side logic contains. Run after `pnpm build`.
// The engine can add its own markers in packages/engine/src/bundle-markers.json (array of strings), so they
// never have to be listed in this public file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = join(root, "apps/web/.next/static");

const MARKERS = {
  "verdict (aggregateVerdict)": "unresolved blocking objection(s)",
  "verdict (feasibility gate)": "Not an implementable solution:",
  "model strength (vote weight warnings)": "of the vote and outweighs all other models together",
  "readiness (pull request gate)": "No sandbox test run exists for this change.",
  "revisions / binding (stopword lists)": "the and for with that this from are was were will",
  prompts: "a structured decision council of several independent AI models",
  "engine guard": "This installation has no CONSYRION engine",
};

const engineMarkers = join(root, "packages/engine/src/bundle-markers.json");
const markers = Object.entries(MARKERS);
if (existsSync(engineMarkers)) for (const text of JSON.parse(readFileSync(engineMarkers, "utf8"))) markers.push(["engine", text]);

if (!existsSync(staticDir)) {
  console.error(`[bundle] ${staticDir} not found – run pnpm build first`);
  process.exit(1);
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.name.endsWith(".js")) yield path;
  }
}

const leaks = [];
let scanned = 0;
for (const file of files(staticDir)) {
  scanned++;
  const content = readFileSync(file, "utf8");
  for (const [area, text] of markers) if (content.includes(text)) leaks.push(`${area}: ${file.slice(root.length + 1)}`);
}

if (leaks.length) {
  console.error(`[bundle] server-side logic found in the browser bundle (#189):\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.info(`[bundle] ${scanned} client chunks clean (${markers.length} markers)`);
