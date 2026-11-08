/**
 * Native tool calling (#284): request mapping (tool definitions, earlier calls and their results) and response parsing
 * per provider family, with mocked SDK clients returning recorded response shapes.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { ensureToolCallIds, parseToolArgs } from "../tools";
import type { ChatMessage, ToolDefinition } from "../types";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OpenAIAdapter } from "./openai";
import { OpenAICompatibleAdapter } from "./openai-compatible";

const tools: ToolDefinition[] = [
  { name: "get_project", description: "One project", parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
];
/** A conversation after one tool round: the model called get_project, the app returned the result. */
const history: ChatMessage[] = [
  { role: "user", content: "Wie steht Projekt X?" },
  { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_project", args: { projectId: "prj_1" } }] },
  { role: "user", content: "", toolResults: [{ callId: "call_1", name: "get_project", content: '{"name":"X"}' }] },
];

describe("tool helpers", () => {
  it("parses arguments from objects and JSON strings; broken JSON is kept for the model, not thrown", () => {
    expect(parseToolArgs({ a: 1 })).toEqual({ a: 1 });
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArgs("")).toEqual({});
    expect(parseToolArgs("[1]")).toEqual({});
    expect(parseToolArgs("{oops")).toEqual({ _invalid_json: "{oops" });
    expect(
      ensureToolCallIds(
        [
          { name: "a", args: {} },
          { id: "x", name: "b", args: {} },
        ],
        "call",
      ),
    ).toEqual([
      { id: "call_0", name: "a", args: {} },
      { id: "x", name: "b", args: {} },
    ]);
  });
});

describe("AnthropicAdapter tools", () => {
  it("sends tools, tool_use and tool_result blocks and returns the calls", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "claude-test",
      content: [
        { type: "text", text: "Ich schaue nach." },
        { type: "tool_use", id: "toolu_2", name: "get_project", input: { projectId: "prj_2" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    const onText = vi.fn();
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    const result = await adapter.generate({ model: "claude-test", messages: history, maxOutputTokens: 500, tools, onText });
    const params = create.mock.calls[0]![0];
    expect(params.stream).toBeUndefined();
    expect(params.tools).toEqual([{ name: "get_project", description: "One project", input_schema: tools[0]!.parameters }]);
    expect(params.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "call_1", name: "get_project", input: { projectId: "prj_1" } }],
    });
    expect(params.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"name":"X"}' }] });
    expect(result).toMatchObject({
      text: "Ich schaue nach.",
      stopReason: "completed",
      toolCalls: [{ id: "toolu_2", name: "get_project", args: { projectId: "prj_2" } }],
      usage: { inputTokens: 50, outputTokens: 20 },
    });
    // With tools the call does not stream; the text reaches onText once.
    expect(onText).toHaveBeenCalledWith("Ich schaue nach.");
  });

  it("without tools nothing changes: no tools field, no toolCalls in the result", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ model: "m", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    const adapter = new AnthropicAdapter({ apiKey: "k", client: { messages: { create } } as unknown as Anthropic });
    const result = await adapter.generate({ model: "m", messages: [{ role: "user", content: "x" }], maxOutputTokens: 10 });
    expect(create.mock.calls[0]![0].tools).toBeUndefined();
    expect(result.toolCalls).toBeUndefined();
  });
});

describe("OpenAIAdapter tools", () => {
  it("sends function tools, function_call and function_call_output items and returns the calls", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "gpt-test",
      status: "completed",
      output_text: "",
      output: [{ type: "function_call", call_id: "call_9", name: "get_project", arguments: '{"projectId":"prj_9"}' }],
      usage: { input_tokens: 30, output_tokens: 10 },
    });
    const adapter = new OpenAIAdapter({ apiKey: "k", client: { responses: { create } } as unknown as OpenAI });
    const result = await adapter.generate({ model: "gpt-test", messages: history, maxOutputTokens: 500, tools, onText: vi.fn() });
    const params = create.mock.calls[0]![0];
    expect(params.stream).toBeUndefined();
    expect(params.tools).toEqual([{ type: "function", name: "get_project", description: "One project", parameters: tools[0]!.parameters, strict: false }]);
    expect(params.input).toEqual([
      { role: "user", content: "Wie steht Projekt X?" },
      { type: "function_call", call_id: "call_1", name: "get_project", arguments: '{"projectId":"prj_1"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"name":"X"}' },
    ]);
    expect(result).toMatchObject({ stopReason: "completed", toolCalls: [{ id: "call_9", name: "get_project", args: { projectId: "prj_9" } }] });
  });
});

describe("GoogleAdapter tools", () => {
  it("sends functionDeclarations, functionCall and functionResponse parts and numbers calls without ids", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      modelVersion: "gemini-test",
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "get_project", args: { projectId: "prj_3" } } }] } }],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
    });
    const adapter = new GoogleAdapter({ apiKey: "k", client: { models: { generateContent } } as unknown as GoogleGenAI });
    const result = await adapter.generate({ model: "gemini-test", messages: history, maxOutputTokens: 500, tools });
    const params = generateContent.mock.calls[0]![0];
    expect(params.config.tools).toEqual([
      { functionDeclarations: [{ name: "get_project", description: "One project", parametersJsonSchema: tools[0]!.parameters }] },
    ]);
    expect(params.contents[1]).toEqual({ role: "model", parts: [{ functionCall: { id: "call_1", name: "get_project", args: { projectId: "prj_1" } } }] });
    expect(params.contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { id: "call_1", name: "get_project", response: { output: '{"name":"X"}' } } }],
    });
    expect(result).toMatchObject({ text: "", stopReason: "completed", toolCalls: [{ id: "call_0", name: "get_project", args: { projectId: "prj_3" } }] });
  });
});

describe("OpenAI-compatible tools (DeepSeek, GLM, Kimi, Qwen, Grok)", () => {
  it("sends tools, assistant tool_calls and tool messages and returns the calls", async () => {
    const create = vi.fn().mockResolvedValue({
      model: "deepseek-test",
      choices: [
        {
          finish_reason: "tool_calls",
          message: { content: null, tool_calls: [{ id: "call_7", type: "function", function: { name: "get_project", arguments: '{"projectId":"prj_7"}' } }] },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
    const adapter = new OpenAICompatibleAdapter("deepseek", { apiKey: "tools-test-key" });
    (adapter as unknown as { clients: unknown[] }).clients = [{ chat: { completions: { create } } }];
    const result = await adapter.generate({ model: "deepseek-test", messages: history, maxOutputTokens: 500, tools, onText: vi.fn() });
    const body = create.mock.calls[0]![0];
    expect(body.stream).toBeUndefined();
    expect(body.tools).toEqual([{ type: "function", function: { name: "get_project", description: "One project", parameters: tools[0]!.parameters } }]);
    expect(body.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_project", arguments: '{"projectId":"prj_1"}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"name":"X"}' },
    ]);
    expect(result).toMatchObject({ text: "", stopReason: "completed", toolCalls: [{ id: "call_7", name: "get_project", args: { projectId: "prj_7" } }] });
  });
});
