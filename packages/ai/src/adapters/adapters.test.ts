/**
 * Contract tests with explicitly mocked SDK clients. They verify request mapping, response
 * normalization and error classification. A real end-to-end call per provider is still pending
 * until API keys are configured (see docs/testing.md).
 */
import Anthropic from "@anthropic-ai/sdk";
import { FinishReason, type GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OpenAIAdapter } from "./openai";

async function* iterate<T>(items: T[]) {
  yield* items;
}

const schema = { name: "proposal", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } };

describe("AnthropicAdapter", () => {
  it("marks the stable prefix for Anthropic's prompt cache (#244)", async () => {
    const create = vi.fn().mockResolvedValue({ model: "c", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    await adapter.generate({ model: "c", system: "sys", messages: [{ role: "user", content: "<brief>B</brief>\n\ntask" }], maxOutputTokens: 10, cachePrefix: "<brief>B</brief>" });
    expect(create.mock.calls[0]![0].messages[0].content).toEqual([
      { type: "text", text: "<brief>B</brief>", cache_control: { type: "ephemeral" } },
      { type: "text", text: "\n\ntask" },
    ]);
    // Without a matching prefix the message stays a plain string.
    await adapter.generate({ model: "c", messages: [{ role: "user", content: "other" }], maxOutputTokens: 10, cachePrefix: "<brief>B</brief>" });
    expect(create.mock.calls[1]![0].messages[0].content).toBe("other");
  });

  it("maps requests and parses structured output", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "claude-test",
      content: [{ type: "text", text: '{"title":"A"}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    const result = await adapter.generate({
      model: "claude-test",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 1000,
      jsonSchema: schema,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: "claude-test",
      max_tokens: 1000,
      system: "sys",
      output_config: { format: { type: "json_schema", schema: schema.schema } },
    });
    expect(result).toMatchObject({ json: { title: "A" }, stopReason: "completed", usage: { inputTokens: 12, outputTokens: 7 } });
  });

  it("reports refusals instead of hiding them", async () => {
    const create = vi.fn().mockResolvedValue({ model: "m", content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } });
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    expect((await adapter.generate({ model: "m", messages: [{ role: "user", content: "x" }], maxOutputTokens: 10 })).stopReason).toBe("refusal");
  });

  it("lists models with limits from the API", async () => {
    const list = () =>
      iterate([
        { id: "claude-x", display_name: "Claude X", max_input_tokens: 1000, max_tokens: 100, capabilities: { structured_outputs: { supported: true } } },
      ]);
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { models: { list } } as unknown as Anthropic });
    expect(await adapter.listModels()).toEqual([
      { provider: "anthropic", modelId: "claude-x", displayName: "Claude X", contextWindow: 1000, maxOutputTokens: 100, supportsStructuredOutput: true },
    ]);
  });

  it("classifies API errors without leaking details", async () => {
    const create = vi.fn().mockRejectedValue(Anthropic.APIError.generate(429, { error: { message: "sk-secret" } }, "rate limited", new Headers()));
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    const error = await adapter.generate({ model: "m", messages: [], maxOutputTokens: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "rate_limit", retryable: true });
    expect((error as Error).message).not.toContain("sk-secret");
  });
});

describe("OpenAIAdapter", () => {
  it("uses the Responses API with a strict JSON schema", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "gpt-test",
      output: [],
      output_text: '{"title":"B"}',
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const adapter = new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI });
    const result = await adapter.generate({
      model: "gpt-test",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 50,
      jsonSchema: schema,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      instructions: "sys",
      max_output_tokens: 50,
      text: { format: { type: "json_schema", name: "proposal", strict: true } },
    });
    expect(result).toMatchObject({ json: { title: "B" }, stopReason: "completed" });
  });

  it("detects refusals and truncation", async () => {
    const refusal = vi.fn().mockResolvedValue({
      model: "m",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      output_text: "",
      status: "completed",
      incomplete_details: null,
      usage: null,
    });
    expect(
      (
        await new OpenAIAdapter({ apiKey: "k", client: { responses: { create: refusal } } as unknown as OpenAI }).generate({
          model: "m",
          messages: [],
          maxOutputTokens: 1,
        })
      ).stopReason,
    ).toBe("refusal");
    const truncated = vi
      .fn()
      .mockResolvedValue({ model: "m", output: [], output_text: "{", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: null });
    const result = await new OpenAIAdapter({ apiKey: "k", client: { responses: { create: truncated } } as unknown as OpenAI }).generate({
      model: "m",
      messages: [],
      maxOutputTokens: 1,
      jsonSchema: schema,
    });
    expect(result).toMatchObject({ stopReason: "max_tokens", json: undefined });
  });

  it("filters non-text models from discovery", async () => {
    const list = () =>
      iterate([{ id: "text-embedding-x" }, { id: "gpt-x" }, { id: "whisper-1" }, { id: "sora-2" }, { id: "gpt-image-1" }, { id: "gpt-live-1" }]);
    const models = await new OpenAIAdapter({ apiKey: "k", client: { models: { list } } as unknown as OpenAI }).listModels();
    expect(models.map((m) => m.modelId)).toEqual(["gpt-x"]);
  });

  it("lists the newest OpenAI models first", async () => {
    const list = () =>
      iterate([
        { id: "gpt-old", created: 100 },
        { id: "gpt-new", created: 300 },
        { id: "gpt-mid", created: 200 },
      ]);
    const models = await new OpenAIAdapter({ apiKey: "k", client: { models: { list } } as unknown as OpenAI }).listModels();
    expect(models.map((m) => m.modelId)).toEqual(["gpt-new", "gpt-mid", "gpt-old"]);
  });

  it("maps auth errors as non-retryable", async () => {
    const create = vi.fn().mockRejectedValue(OpenAI.APIError.generate(401, undefined, "bad key", new Headers()));
    const error = await new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI })
      .generate({ model: "m", messages: [], maxOutputTokens: 1 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "auth", retryable: false });
  });
});

describe("GoogleAdapter", () => {
  it("maps roles, system instruction and JSON schema", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"title":"C"}',
      modelVersion: "gemini-test-001",
      candidates: [{ finishReason: FinishReason.STOP }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 3 },
    });
    const adapter = new GoogleAdapter({ apiKey: "k", client: { models: { generateContent } } as unknown as GoogleGenAI });
    const result = await adapter.generate({
      model: "gemini-test",
      system: "sys",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      maxOutputTokens: 9,
      jsonSchema: schema,
    });
    const params = generateContent.mock.calls[0]![0];
    expect(params.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model"]);
    expect(params.config).toMatchObject({ systemInstruction: "sys", responseMimeType: "application/json", maxOutputTokens: 9 });
    expect(result).toMatchObject({ json: { title: "C" }, model: "gemini-test-001", usage: { inputTokens: 4, outputTokens: 5 } });
  });

  it("treats safety blocks as refusals", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "", candidates: [{ finishReason: FinishReason.SAFETY }] });
    const result = await new GoogleAdapter({ apiKey: "k", client: { models: { generateContent } } as unknown as GoogleGenAI }).generate({
      model: "g",
      messages: [],
      maxOutputTokens: 1,
    });
    expect(result.stopReason).toBe("refusal");
  });

  it("only lists models that support generateContent", async () => {
    const list = vi.fn().mockResolvedValue(
      iterate([
        { name: "models/gemini-x", displayName: "Gemini X", inputTokenLimit: 10, outputTokenLimit: 5, supportedActions: ["generateContent"] },
        { name: "models/embedding-x", supportedActions: ["embedContent"] },
        { name: "models/gemini-x-preview-tts", displayName: "Gemini X Preview TTS", supportedActions: ["generateContent"] },
        { name: "models/gemini-x-image", displayName: "Gemini X Image", supportedActions: ["generateContent"] },
      ]),
    );
    const models = await new GoogleAdapter({ apiKey: "k", client: { models: { list } } as unknown as GoogleGenAI }).listModels();
    expect(models).toEqual([
      { provider: "google", modelId: "gemini-x", displayName: "Gemini X", contextWindow: 10, maxOutputTokens: 5, supportsStructuredOutput: null },
    ]);
  });
});

describe("DeepSeekAdapter", () => {
  it("uses chat completions with JSON mode and the schema in the system prompt", async () => {
    const { DeepSeekAdapter } = await import("./deepseek");
    const create = vi.fn().mockResolvedValue({
      model: "deepseek-x",
      choices: [{ message: { content: '{"title":"D"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
    });
    const adapter = new DeepSeekAdapter({ apiKey: "k", client: { chat: { completions: { create } } } as unknown as OpenAI });
    const result = await adapter.generate({
      model: "deepseek-x",
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 16_000,
      jsonSchema: schema,
    });
    const params = create.mock.calls[0]![0];
    expect(params.response_format).toEqual({ type: "json_object" });
    // Coding tasks need room: requests are no longer capped at the old 8K (#live test).
    expect(params.max_tokens).toBe(16_000);
    expect(params.messages[0].content).toContain("json object");
    expect(params.messages[0].content).toContain('"title"');
    expect(result).toMatchObject({ json: { title: "D" }, stopReason: "completed", usage: { inputTokens: 9, outputTokens: 4 } });
  });

  it("maps truncation and an exhausted balance", async () => {
    const { DeepSeekAdapter } = await import("./deepseek");
    const cut = vi.fn().mockResolvedValue({ model: "m", choices: [{ message: { content: "{" }, finish_reason: "length" }], usage: null });
    expect(
      (
        await new DeepSeekAdapter({ apiKey: "k", client: { chat: { completions: { create: cut } } } as unknown as OpenAI }).generate({
          model: "m",
          messages: [],
          maxOutputTokens: 1,
        })
      ).stopReason,
    ).toBe("max_tokens");
    const broke = vi.fn().mockRejectedValue(OpenAI.APIError.generate(402, undefined, "Insufficient Balance", new Headers()));
    const error = await new DeepSeekAdapter({ apiKey: "k", client: { chat: { completions: { create: broke } } } as unknown as OpenAI })
      .generate({ model: "m", messages: [], maxOutputTokens: 1 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "auth", retryable: false });
    expect((error as Error).message).toContain("insufficient balance");
  });
});

describe("image input for image descriptions", () => {
  const image = { mediaType: "image/png" as const, data: "iVBORw0KGgo=" };
  const messages = [{ role: "user" as const, content: "Describe", images: [image] }];

  it("Anthropic: base64 image block before the text", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ model: "m", content: [{ type: "text", text: "x" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    await new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic }).generate({
      model: "m",
      messages,
      maxOutputTokens: 10,
    });
    expect(create.mock.calls[0]![0].messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: image.data } },
      { type: "text", text: "Describe" },
    ]);
  });

  it("OpenAI: input_image as data URL before the text", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "m",
      output: [],
      output_text: "x",
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI }).generate({ model: "m", messages, maxOutputTokens: 10 });
    expect(create.mock.calls[0]![0].input[0].content).toEqual([
      { type: "input_image", image_url: `data:image/png;base64,${image.data}`, detail: "auto" },
      { type: "input_text", text: "Describe" },
    ]);
  });

  it("Gemini: inlineData part before the text; messages without images are unchanged", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "x", candidates: [{ finishReason: FinishReason.STOP }], usageMetadata: {} });
    const adapter = new GoogleAdapter({ apiKey: "k", client: { models: { generateContent } } as unknown as GoogleGenAI });
    await adapter.generate({ model: "m", messages: [...messages, { role: "assistant", content: "ok" }], maxOutputTokens: 10 });
    expect(generateContent.mock.calls[0]![0].contents).toEqual([
      { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: image.data } }, { text: "Describe" }] },
      { role: "model", parts: [{ text: "ok" }] },
    ]);
  });
});
