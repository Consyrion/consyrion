import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "./openapi";

describe("OpenAPI document of API v1 (#101)", () => {
  it("describes exactly the endpoints an integration token may use, with a handler for every method", () => {
    const api = join(__dirname, "../app/api");
    const toRoute = (path: string) => path.replace("{documentId}", "[docId]").replace(/\{(projectId|sessionId)\}/g, "[id]");
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      const source = readFileSync(join(api, toRoute(path), "route.ts"), "utf8");
      for (const method of Object.keys(item).filter((k) => k !== "parameters")) {
        const handler = source.match(new RegExp(`export const ${method.toUpperCase()} = handle\\(async[\\s\\S]*?(?=\\nexport const |$)`))?.[0];
        expect(handler, `${method} ${path}`).toContain("requireActor({ integration: true })");
      }
    }
  });

  it("never contains an example token or key", () => {
    expect(JSON.stringify(openApiDocument)).not.toMatch(/(cn[si]_[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9-]{10,})/);
  });
});
