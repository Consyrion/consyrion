import Anthropic from "@anthropic-ai/sdk";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import { parseToolArgs } from "../tools";
import { tokenUsage, type ChatMessage, type DiscoveredModel, type GenerateRequest, type GenerateResult, type ProviderAdapter, type StopReason, type TokenUsage } from "../types";

export interface AnthropicAdapterOptions {
  apiKey: string;
  timeoutMs?: number;
  /** Injected for tests; production code lets the adapter build the SDK client. */
  client?: Anthropic;
}

/**
 * Anthropic Messages API adapter. Retries are disabled in the SDK because the council
 * orchestrator owns retry and budget policy (see ../retry.ts).
 *
 * No server-side refusal fallback is configured on purpose: in a council every answer must come
 * from the model the user selected, so a refusal is reported as such instead of being answered
 * silently by a different model.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(options: AnthropicAdapterOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? SDK_BACKSTOP_TIMEOUT_MS });
  }

  async listModels(signal?: AbortSignal): Promise<DiscoveredModel[]> {
    try {
      const models: DiscoveredModel[] = [];
      for await (const model of this.client.models.list({}, { signal })) {
        const capabilities = (model as { capabilities?: { structured_outputs?: { supported?: boolean } } }).capabilities;
        models.push({
          provider: this.provider,
          modelId: model.id,
          displayName: model.display_name,
          contextWindow: (model as { max_input_tokens?: number }).max_input_tokens ?? null,
          maxOutputTokens: (model as { max_tokens?: number }).max_tokens ?? null,
          supportsStructuredOutput: capabilities?.structured_outputs?.supported ?? null,
        });
      }
      return models;
    } catch (error) {
      throw this.normalize(error, signal);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const params = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: withCacheBreakpoint(request.messages.map(toAnthropicMessage), request.cachePrefix),
        ...(request.jsonSchema ? { output_config: { format: { type: "json_schema", schema: request.jsonSchema.schema } } } : {}),
        ...(request.tools?.length
          ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object", ...t.parameters } })) }
          : {}),
      } as Anthropic.MessageCreateParamsNonStreaming;
      // Tools use the non-streaming call (#284); the text then reaches onText once at the end.
      if (request.onText && !request.tools?.length) return await this.stream(params, request);
      const response = await this.client.messages.create(params, { signal: request.signal });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      const toolCalls = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
        .map((block) => ({ id: block.id, name: block.name, args: parseToolArgs(block.input) }));
      if (request.onText && text) request.onText(text);
      return {
        provider: this.provider,
        model: response.model,
        text,
        json: request.jsonSchema ? parseJsonOutput(text) : undefined,
        stopReason: mapStopReason(response.stop_reason),
        usage: anthropicUsage(response.usage),
        ...(request.tools?.length ? { toolCalls } : {}),
      };
    } catch (error) {
      throw this.normalize(error, request.signal);
    }
  }

  /** Streaming variant: text deltas go to `onText`; usage and stop reason come from the message_start/message_delta events. */
  private async stream(params: Anthropic.MessageCreateParamsNonStreaming, request: GenerateRequest): Promise<GenerateResult> {
    const events = await this.client.messages.create({ ...params, stream: true }, { signal: request.signal });
    let text = "";
    let model = request.model;
    let stopReason: string | null = null;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of events) {
      if (event.type === "message_start") {
        model = event.message.model;
        // The input side (including cache reads, #244) is complete in message_start.
        usage = anthropicUsage(event.message.usage);
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        request.onText!(event.delta.text);
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason;
        // Cumulative output tokens of the whole message.
        usage = { ...usage, outputTokens: event.usage.output_tokens };
      }
    }
    // The SDK streams end quietly when the signal aborts (live test 06.11.26) – report it as a cancellation.
    if (request.signal?.aborted) throw abortError(this.provider, request.signal.reason, request.signal);
    return {
      provider: this.provider,
      model,
      text,
      json: request.jsonSchema ? parseJsonOutput(text) : undefined,
      stopReason: mapStopReason(stopReason),
      usage,
    };
  }

  private normalize(error: unknown, signal?: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error;
    if (error instanceof Anthropic.APIUserAbortError || isAbortError(error)) return abortError(this.provider, error, signal);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError(this.provider, "timeout", "Request timed out");
    if (error instanceof Anthropic.APIConnectionError) return new ProviderError(this.provider, "unavailable", "Could not reach Anthropic");
    if (error instanceof Anthropic.APIError) {
      return new ProviderError(this.provider, kindFromStatus(error.status), `Anthropic API error ${error.status ?? ""}`.trim(), error.status);
    }
    return new ProviderError(this.provider, "unknown", "Unexpected Anthropic adapter error");
  }
}

/** Text, images, tool calls (assistant) and tool results (user) as Anthropic content blocks. */
function toAnthropicMessage(m: ChatMessage) {
  if (m.toolCalls?.length)
    return {
      role: "assistant" as const,
      content: [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.args })),
      ],
    };
  if (m.toolResults?.length)
    return {
      role: "user" as const,
      content: [
        ...m.toolResults.map((r) => ({ type: "tool_result" as const, tool_use_id: r.callId, content: r.content })),
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
      ],
    };
  if (m.images?.length)
    return {
      role: m.role,
      content: [
        ...m.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })),
        { type: "text" as const, text: m.content },
      ],
    };
  return { role: m.role, content: m.content };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "tool_use":
      return "completed";
    case "end_turn":
    case "stop_sequence":
      return "completed";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * Anthropic's `input_tokens` excludes tokens read from or written to the prompt cache (#244); they are added here so
 * `inputTokens` is the full input like for every other provider, and the cache reads are reported separately.
 */
function anthropicUsage(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): TokenUsage {
  const read = usage.cache_read_input_tokens ?? 0;
  const created = usage.cache_creation_input_tokens ?? 0;
  return tokenUsage(usage.input_tokens + read + created, usage.output_tokens, read);
}

/**
 * Prompt caching (#244): Anthropic caches only up to an explicit `cache_control` marker. When the first user message
 * starts with the stable prefix, it is split into the prefix (marked) and the rest, so every later call with the same
 * system prompt and prefix reads it from the cache. Prefixes below Anthropic's minimum cacheable length are simply not
 * cached; nothing else changes.
 */
function withCacheBreakpoint(messages: ReturnType<typeof toAnthropicMessage>[], prefix: string | undefined) {
  const first = messages[0];
  if (!prefix || !first || first.role !== "user" || typeof first.content !== "string" || !first.content.startsWith(prefix) || first.content.length === prefix.length)
    return messages;
  const marked = {
    role: "user" as const,
    content: [
      { type: "text" as const, text: prefix, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: first.content.slice(prefix.length) },
    ],
  };
  return [marked, ...messages.slice(1)];
}
