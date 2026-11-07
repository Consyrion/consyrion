/**
 * Streaming (#284): each adapter replays recorded stream events (shape of the providers' documented SSE events) from a
 * mocked SDK client. Checks: deltas reach onText in order, the result equals the non-streaming shape (text, JSON,
 * stop reason, usage from the provider's final event), and an AbortSignal ends the stream as a cancellation.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { FinishReason, type GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OpenAIAdapter } from "./openai";
import { OpenAICompatibleAdapter } from "./openai-compatible";

async function* replay<T>(events: T[]) {
  yield* events;
}

/** Like the real SDK streams (live test 06.11.26): on abort the iteration just ends, without an error. */
function quietOnAbort<T>(events: T[], signal: AbortSignal | undefined) {
  return (async function* () {
    for (const e of events) {
      if (signal?.aborted) return;
      yield e;
    }
  })();
}

/** A stream that yields one event and then hangs until the signal aborts – like an SDK stream on a slow model. */
function hanging<T>(first: T, signal: AbortSignal | undefined) {
  return (async function* () {
    yield first;
    await new Promise((_, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal?.aborted) fail();
      signal?.addEventListener("abort", fail);
    });
  })();
}

const schema = { name: "step", schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } };

function collect() {
  const deltas: string[] = [];
  return { deltas, onText: (d: string) => deltas.push(d) };
}

describe("streaming (#284)", () => {
  it("Anthropic: text deltas, usage from message_start + message_delta, stop reason", async () => {
    const events = [
      { type: "message_start", message: { model: "claude-test", usage: { input_tokens: 40, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"answer":"Hal' } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: 'lo"}' } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
      { type: "message_stop" },
    ];
    const create = vi.fn().mockResolvedValue(replay(events));
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    const { deltas, onText } = collect();
    const result = await adapter.generate({
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 100,
      jsonSchema: schema,
      onText,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({ stream: true, model: "claude-test" });
    expect(deltas).toEqual(['{"answer":"Hal', 'lo"}']);
    expect(result).toMatchObject({
      text: '{"answer":"Hallo"}',
      json: { answer: "Hallo" },
      stopReason: "completed",
      usage: { inputTokens: 40, outputTokens: 9 },
      model: "claude-test",
    });
  });

  it("OpenAI: output_text deltas, final response.completed carries usage and status", async () => {
    const final = {
      model: "gpt-test",
      output: [],
      output_text: "",
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 30, output_tokens: 4 },
    };
    const events = [
      { type: "response.created", response: { ...final, status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.completed", response: final },
    ];
    const create = vi.fn().mockResolvedValue(replay(events));
    const adapter = new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI });
    const { deltas, onText } = collect();
    const result = await adapter.generate({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, onText });
    expect(create.mock.calls[0]![0]).toMatchObject({ stream: true });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result).toMatchObject({ text: "Hello", stopReason: "completed", usage: { inputTokens: 30, outputTokens: 4 } });
  });

  it("OpenAI: an incomplete response at the output limit is reported as max_tokens", async () => {
    const final = {
      model: "gpt-test",
      output: [],
      output_text: "",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      usage: { input_tokens: 1, output_tokens: 100 },
    };
    const create = vi.fn().mockResolvedValue(
      replay([
        { type: "response.output_text.delta", delta: "cut" },
        { type: "response.incomplete", response: final },
      ]),
    );
    const adapter = new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI });
    const result = await adapter.generate({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, onText: () => {} });
    expect(result).toMatchObject({ text: "cut", stopReason: "max_tokens" });
  });

  it("Gemini: chunks, finish reason and usage from the last chunk", async () => {
    const chunks = [
      { text: "Hal", candidates: [{}] },
      {
        text: "lo",
        candidates: [{ finishReason: FinishReason.STOP }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 2 },
        modelVersion: "gemini-test",
      },
    ];
    const generateContentStream = vi.fn().mockResolvedValue(replay(chunks));
    const adapter = new GoogleAdapter({ apiKey: "k", client: { models: { generateContentStream } } as unknown as GoogleGenAI });
    const { deltas, onText } = collect();
    const result = await adapter.generate({ model: "gemini-test", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, onText });
    expect(deltas).toEqual(["Hal", "lo"]);
    expect(result).toMatchObject({ text: "Hallo", stopReason: "completed", usage: { inputTokens: 20, outputTokens: 7 }, model: "gemini-test" });
  });

  it("OpenAI-compatible (DeepSeek, Grok …): content deltas, usage from the last chunk via include_usage", async () => {
    const chunks = [
      { model: "deepseek-test", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
      { model: "deepseek-test", choices: [{ index: 0, delta: { content: "Hal" } }] },
      { model: "deepseek-test", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] },
      { model: "deepseek-test", choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } },
    ];
    const create = vi.fn().mockResolvedValue(replay(chunks));
    const adapter = new OpenAICompatibleAdapter("deepseek", { apiKey: "stream-test", client: { chat: { completions: { create } } } as unknown as OpenAI });
    const { deltas, onText } = collect();
    const result = await adapter.generate({ model: "deepseek-test", messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, onText });
    expect(create.mock.calls[0]![0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(deltas).toEqual(["Hal", "lo"]);
    expect(result).toMatchObject({ text: "Hallo", stopReason: "completed", usage: { inputTokens: 12, outputTokens: 3 } });
  });

  it("an AbortSignal ends the stream as a cancellation (ProviderError cancelled) for every adapter", async () => {
    const cases: Array<(signal: AbortSignal) => { generate: () => Promise<unknown> }> = [
      (signal) => {
        const create = vi.fn().mockImplementation(async () => hanging({ type: "content_block_delta", delta: { type: "text_delta", text: "a" } }, signal));
        const a = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
        return { generate: () => a.generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText: () => {} }) };
      },
      (signal) => {
        const create = vi.fn().mockImplementation(async () => hanging({ type: "response.output_text.delta", delta: "a" }, signal));
        const a = new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI });
        return { generate: () => a.generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText: () => {} }) };
      },
      (signal) => {
        const generateContentStream = vi.fn().mockImplementation(async () => hanging({ text: "a" }, signal));
        const a = new GoogleAdapter({ apiKey: "k", client: { models: { generateContentStream } } as unknown as GoogleGenAI });
        return { generate: () => a.generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText: () => {} }) };
      },
      (signal) => {
        const create = vi.fn().mockImplementation(async () => hanging({ model: "m", choices: [{ index: 0, delta: { content: "a" } }] }, signal));
        const a = new OpenAICompatibleAdapter("xai", { apiKey: "abort-test", client: { chat: { completions: { create } } } as unknown as OpenAI });
        return { generate: () => a.generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText: () => {} }) };
      },
    ];
    for (const make of cases) {
      const controller = new AbortController();
      const running = make(controller.signal).generate();
      setTimeout(() => controller.abort(), 5);
      const error = await running.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind: "cancelled" });
    }
  });

  it("reports a cancellation when the SDK stream ends quietly after an abort (Anthropic, OpenAI, compatible)", async () => {
    const make = (signal: AbortSignal, onText: (d: string) => void): Array<() => Promise<unknown>> => [
      () =>
        new AnthropicAdapter({
          apiKey: "k",
          client: {
            messages: {
              create: vi.fn().mockImplementation(async () =>
                quietOnAbort(
                  [1, 2, 3].map((n) => ({ type: "content_block_delta", delta: { type: "text_delta", text: `${n}` } })),
                  signal,
                ),
              ),
            },
          } as unknown as Anthropic,
        }).generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText }),
      () =>
        new OpenAIAdapter({
          apiKey: "k",
          client: {
            responses: {
              create: vi.fn().mockImplementation(async () =>
                quietOnAbort(
                  [
                    { type: "response.output_text.delta", delta: "1" },
                    { type: "response.output_text.delta", delta: "2" },
                  ],
                  signal,
                ),
              ),
            },
          } as unknown as OpenAI,
        }).generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText }),
      () =>
        new OpenAICompatibleAdapter("deepseek", {
          apiKey: "quiet-abort",
          client: {
            chat: {
              completions: {
                create: vi.fn().mockImplementation(async () =>
                  quietOnAbort(
                    [
                      { model: "m", choices: [{ index: 0, delta: { content: "1" } }] },
                      { model: "m", choices: [{ index: 0, delta: { content: "2" } }] },
                    ],
                    signal,
                  ),
                ),
              },
            },
          } as unknown as OpenAI,
        }).generate({ model: "m", messages: [], maxOutputTokens: 10, signal, onText }),
    ];
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController();
      const error = await make(controller.signal, () => controller.abort())[i]!().catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: "cancelled" });
    }
  });
});
