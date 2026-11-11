import { createDatabase, type DatabaseHandle } from "@consyrium/db";
import { strengthSuggestion } from "@consyrium/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchArtificialAnalysis } from "@consyrium/ai";
import { latestStrengthCatalog, modelStrengthStatus, syncModelStrength, type StrengthSource } from "../src";

let handle: DatabaseHandle;
beforeEach(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
});
afterEach(async () => handle.close());

// Test data only – not real rankings.
const entries = [
  { sourceModelId: "a", slug: "kimi-k2-6", name: "Kimi K2.6", creator: "Moonshot AI", score: 60 },
  { sourceModelId: "b", slug: "gpt-5-mini", name: "GPT-5 mini", creator: "OpenAI", score: 40 },
];
const source = (load: StrengthSource["load"]): StrengthSource => ({ source: "Test ranking", sourceUrl: "https://example.test", load });

describe("model strength sync (#139)", () => {
  it("stores the ranking, keeps the last good catalog when a fetch fails and logs the error", async () => {
    expect(await latestStrengthCatalog(handle.db)).toBeNull();
    expect(
      await syncModelStrength(
        handle.db,
        source(async () => entries),
      ),
    ).toEqual({ ok: true, entries: 2 });
    expect(
      await syncModelStrength(
        handle.db,
        source(async () => Promise.reject(new Error("HTTP 500"))),
      ),
    ).toEqual({ ok: false, error: "HTTP 500" });
    const catalog = await latestStrengthCatalog(handle.db);
    expect(catalog?.entries).toHaveLength(2);
    expect(strengthSuggestion("kimi", "kimi-k2.6", catalog).status).toBe("known");
    const status = await modelStrengthStatus(handle.db);
    expect(status.lastAttempt).toMatchObject({ ok: false, error: "HTTP 500" });
    expect(status.lastSuccess?.source).toBe("Test ranking");
  });

  it("reads the Artificial Analysis response and skips models without an index", async () => {
    const fake = (async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "1",
              slug: "kimi-k2-6",
              name: "Kimi K2.6",
              model_creator: { name: "Moonshot AI" },
              evaluations: { artificial_analysis_intelligence_index: 60 },
            },
            {
              id: "3",
              slug: "grok-4-20-0309-non-reasoning",
              name: "Grok 4.20 0309 (non-reasoning)",
              model_creator: { name: "SpaceXAI", slug: "xai" },
              evaluations: { artificial_analysis_intelligence_index: 45 },
            },
            { id: "2", slug: "no-index", name: "No index", model_creator: { name: "X" }, evaluations: {} },
          ],
        }),
      );
    }) as typeof fetch;
    expect(await fetchArtificialAnalysis("test-key", fake)).toEqual([
      { sourceModelId: "1", slug: "kimi-k2-6", name: "Kimi K2.6", creator: "Moonshot AI", score: 60 },
      { sourceModelId: "3", slug: "grok-4-20-0309-non-reasoning", name: "Grok 4.20 0309 (non-reasoning)", creator: "SpaceXAI", creatorSlug: "xai", score: 45 },
    ]);
    await expect(fetchArtificialAnalysis("bad", (async () => new Response("", { status: 401 })) as typeof fetch)).rejects.toThrow("HTTP 401");
  });
});
