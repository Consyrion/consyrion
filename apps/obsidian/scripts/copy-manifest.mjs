// Copies manifest.json next to dist/main.js, so dist/ is a complete plugin folder (main.js + manifest.json).
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(join(root, "manifest.json"), join(root, "dist", "manifest.json"));
