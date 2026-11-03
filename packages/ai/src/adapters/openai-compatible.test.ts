import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import type { ProviderError } from "../errors";
import { isCouncilCapableModel } from "../model-filter";
import { SDK_BACKSTOP_TIMEOUT_MS, timeoutSignal } from "../retry";
import { createAdapter } from "../registry";
import { COMPATIBLE_PROVIDERS, OpenAICompatibleAdapter } from "./openai-compatible";

const unauthorized = () => OpenAI.APIError.generate(401, undefined, "Invalid key", new Headers());
const notFound = () => OpenAI.APIError.generate(404, undefined, "Not found", new Headers());

/** Injects one fake client per endpoint into the adapter (test seam on the private field). */
function withClients(adapter: OpenAICompatibleAdapter, clients: unknown[]) {
  (adapter as unknown as { clients: unknown[] }).clients = clients;
  return adapter;
}

const completion = { model: "m", choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } };

describe("OpenAI-compatible providers (GLM, Kimi, Qwen, Grok)", () => {
  it("lists the international endpoint first and the China mainland endpoint as fallback", () => {
    expect(COMPATIBLE_PROVIDERS.glm.baseUrls[0]).toBe("https://api.z.ai/api/paas/v4");
    expect(COMPATIBLE_PROVIDERS.kimi.baseUrls).toEqual(["https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1"]);
    expect(COMPATIBLE_PROVIDERS.qwen.baseUrls[0]).toContain("dashscope-intl");
    expect(COMPATIBLE_PROVIDERS.xai.baseUrls).toEqual(["https://api.x.ai/v1"]);
  });

  it("creates adapters for glm, kimi, qwen and xai from the registry", () => {
    for (const provider of ["glm", "kimi", "qwen", "xai"] as const) expect(createAdapter(provider, `key-${provider}`).provider).toBe(provider);
  });

  it("falls back to the second region when the first rejects the key, and remembers it", async () => {
    const intl = vi.fn().mockRejectedValue(unauthorized());
    const china = vi.fn().mockResolvedValue(completion);
    const adapter = withClients(new OpenAICompatibleAdapter("kimi", { apiKey: "region-test-key" }), [
      { chat: { completions: { create: intl } } },
      { chat: { completions: { create: china } } },
    ]);
    const result = await adapter.generate({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 20_000,
      jsonSchema: { name: "x", schema: {} },
    });
    expect(result.json).toEqual({ ok: true });
    expect(china.mock.calls[0]![0].max_tokens).toBe(20_000);
    expect(china.mock.calls[0]![0].response_format).toEqual({ type: "json_object" });
    // Second call goes straight to the endpoint that accepted the key.
    const again = withClients(new OpenAICompatibleAdapter("kimi", { apiKey: "region-test-key" }), [
      { chat: { completions: { create: intl } } },
      { chat: { completions: { create: china } } },
    ]);
    await again.generate({ model: "m", messages: [], maxOutputTokens: 10 });
    expect(intl).toHaveBeenCalledTimes(1);
    expect(china).toHaveBeenCalledTimes(2);
  });

  it("falls back to 8K output when a model rejects the larger completion limit", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(OpenAI.APIError.generate(400, undefined, "Invalid max_tokens value, the valid range of max_tokens is [1, 8192]", new Headers()))
      .mockResolvedValueOnce(completion);
    const adapter = withClients(new OpenAICompatibleAdapter("deepseek", { apiKey: "fallback-key" }), [{ chat: { completions: { create } } }]);
    await adapter.generate({ model: "m", messages: [], maxOutputTokens: 16_000 });
    expect(create.mock.calls.map((c) => c[0].max_tokens)).toEqual([16_000, 8_192]);
  });

  it("reports an invalid key when every region rejects it", async () => {
    const reject = vi.fn().mockRejectedValue(unauthorized());
    const adapter = withClients(new OpenAICompatibleAdapter("qwen", { apiKey: "bad" }), [
      { chat: { completions: { create: reject } } },
      { chat: { completions: { create: reject } } },
    ]);
    const error = await adapter.generate({ model: "m", messages: [], maxOutputTokens: 1 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "auth", provider: "qwen" });
    expect((error as Error).message).toContain("Alibaba Qwen");
  });

  it("accepts a key whose provider has no models endpoint and returns no models (manual model ids)", async () => {
    const list = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(notFound()) }),
    }));
    const adapter = withClients(new OpenAICompatibleAdapter("glm", { apiKey: "k" }), [{ models: { list } }]);
    await expect(adapter.listModels()).resolves.toEqual([]);
  });

  it("lists only council-capable models through the real discovery path (#118)", async () => {
    const ids = ["grok-4.7", "grok-imagine-image", "grok-imagine-image-2.0", "grok-imagine-video-1.5", "grok-code-fast-1", "grok-4.20-0309-non-reasoning"];
    const list = vi.fn(() => ({
      [Symbol.asyncIterator]: () => {
        let i = 0;
        return { next: () => Promise.resolve(i < ids.length ? { value: { id: ids[i++] }, done: false } : { value: undefined, done: true }) };
      },
    }));
    const adapter = withClients(new OpenAICompatibleAdapter("xai", { apiKey: "k" }), [{ models: { list } }]);
    expect((await adapter.listModels()).map((m) => m.modelId)).toEqual(["grok-4.7", "grok-code-fast-1", "grok-4.20-0309-non-reasoning"]);
  });

  it("tells the call deadline from a cancellation and a connection timeout (#120)", async () => {
    // Like the SDK: an aborted request rejects with APIUserAbortError, whatever aborted it.
    const hang = vi.fn(
      (_body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError()), { once: true })),
    );
    const adapter = withClients(new OpenAICompatibleAdapter("glm", { apiKey: "k" }), [{ chat: { completions: { create: hang } } }]);
    const request = { model: "glm-4.7", messages: [], maxOutputTokens: 1 };

    const failure = (promise: Promise<unknown>) => promise.then(() => null).catch((e: unknown) => e as ProviderError);
    const deadline = (await failure(adapter.generate({ ...request, signal: timeoutSignal(20) })))!;
    expect(deadline).toMatchObject({ kind: "timeout", deadline: true, provider: "glm" });
    // Not retried by the transient retry loop: it would wait the whole deadline again.
    expect(deadline.retryable).toBe(false);

    const user = new AbortController();
    const cancelled = failure(adapter.generate({ ...request, signal: user.signal }));
    user.abort();
    expect(await cancelled).toMatchObject({ kind: "cancelled" });
    expect((await cancelled)!.retryable).toBe(false);

    const slowNetwork = withClients(new OpenAICompatibleAdapter("glm", { apiKey: "k" }), [
      { chat: { completions: { create: vi.fn().mockRejectedValue(new OpenAI.APIConnectionTimeoutError()) } } },
    ]);
    const connection = (await failure(slowNetwork.generate(request)))!;
    expect(connection).toMatchObject({ kind: "timeout", deadline: false });
    expect(connection.retryable).toBe(true);
  });

  it("keeps the SDK timeout above every call deadline (backstop only)", () => {
    const adapter = new OpenAICompatibleAdapter("glm", { apiKey: "k" });
    const timeouts = (adapter as unknown as { clients: Array<{ timeout: number }> }).clients.map((c) => c.timeout);
    expect(Math.min(...timeouts)).toBe(SDK_BACKSTOP_TIMEOUT_MS);
    expect(SDK_BACKSTOP_TIMEOUT_MS).toBeGreaterThan(300_000 * 1.5);
  });

  it("filters Qwen and GLM media models out of council model lists", () => {
    for (const id of [
      "wanx2.1-t2i-turbo",
      "wan2.2-t2v-plus",
      "paraformer-v2",
      "cosyvoice-v2",
      "qwen3-asr-flash",
      "gte-rerank-v2",
      "text-embedding-v4",
      "cogview-4",
      "cogvideox-3",
      "grok-imagine-image",
      "grok-imagine-video",
      "nano-banana-pro-preview",
      "gemini-nano-banana-2.1",
      "antigravity-preview-05",
    ])
      expect(isCouncilCapableModel(id), id).toBe(false);
    for (const id of ["qwen3-max", "qwen-plus", "glm-4.6", "kimi-k2-turbo-preview", "grok-4", "grok-code-fast-1", "gemini-2.5-flash", "gemini-flash-latest"])
      expect(isCouncilCapableModel(id), id).toBe(true);
  });

  it("sends an image as image_url data URL before the text (xAI, Kimi, Qwen, GLM)", async () => {
    const create = vi.fn().mockResolvedValue(completion);
    const adapter = withClients(new OpenAICompatibleAdapter("xai", { apiKey: "k" }), [{ chat: { completions: { create } } }]);
    await adapter.generate({ model: "m", messages: [{ role: "user", content: "Describe", images: [{ mediaType: "image/jpeg", data: "/9j/" }] }], maxOutputTokens: 10 });
    expect(create.mock.calls[0]![0].messages.at(-1).content).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } },
      { type: "text", text: "Describe" },
    ]);
  });
});
