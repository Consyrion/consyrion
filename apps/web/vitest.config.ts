import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Component tests render to static markup, so JSX needs the automatic runtime (Next uses "preserve").
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node" },
});
