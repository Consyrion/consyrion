/**
 * Prompt-cache usage (#244): every adapter reports `inputTokens` as the full input (cached tokens included) and the
 * cached part separately as `cachedInputTokens`, so budgets count each token once and the cache share is visible.
 */
import Anthropic from "@anthropic-ai/sdk";
import { FinishReason, type GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OpenAIAdapter } from "./openai";
import { OpenAICompatibleAdapter } from "./openai-compatible";

const request = { model: "m", messages: [{ role: "user" as const, content: "hi" }], maxOutputTokens: 100 };

describe("cached input tokens (#244)", () => {
  it("Anthropic: adds cache reads and writes to input_tokens (which excludes them) and reports the reads", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 },
    });
    const result = await new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic }).generate(request);
    expect(result.usage).toEqual({ inputTokens: 9600, outputTokens: 7, cachedInputTokens: 9000 });
  });

  it("Anthropic streaming: the cache reads come with message_start", async () => {
    async function* events() {
      yield { type: "message_start", message: { model: "claude-test", usage: { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 4000 } } };
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } };
    }
    const create = vi.fn().mockResolvedValue(events());
    const result = await new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic }).generate({ ...request, onText: () => {} });
    expect(result.usage).toEqual({ inputTokens: 4050, outputTokens: 6, cachedInputTokens: 4000 });
  });

  it("OpenAI Responses: input_tokens includes the cached ones", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "gpt-test",
      output: [],
      output_text: "ok",
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 2000, output_tokens: 3, input_tokens_details: { cached_tokens: 1536 } },
    });
    const result = await new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI }).generate(request);
    expect(result.usage).toEqual({ inputTokens: 2000, outputTokens: 3, cachedInputTokens: 1536 });
  });

  it("OpenAI-compatible (DeepSeek, GLM, Kimi, Qwen, Grok): prompt_tokens_details.cached_tokens", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "glm-x",
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 1024 } },
    });
    const adapter = new OpenAICompatibleAdapter("glm", { apiKey: "k", client: { chat: { completions: { create } } } as unknown as OpenAI });
    expect((await adapter.generate(request)).usage).toEqual({ inputTokens: 1200, outputTokens: 4, cachedInputTokens: 1024 });
  });

  it("Gemini: cachedContentTokenCount is part of promptTokenCount", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "ok",
      modelVersion: "gemini-test",
      candidates: [{ finishReason: FinishReason.STOP }],
      usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 2, thoughtsTokenCount: 1, cachedContentTokenCount: 2048 },
    });
    const result = await new GoogleAdapter({ apiKey: "k", client: { models: { generateContent } } as unknown as GoogleGenAI }).generate(request);
    expect(result.usage).toEqual({ inputTokens: 3000, outputTokens: 3, cachedInputTokens: 2048 });
  });

  it("leaves the usage unchanged when nothing was cached", async () => {
    const create = vi.fn().mockResolvedValue({ model: "c", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 7 } });
    const result = await new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic }).generate(request);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });
});
