import Anthropic from "@anthropic-ai/sdk";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import type { DiscoveredModel, GenerateRequest, GenerateResult, ProviderAdapter, StopReason } from "../types";

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
        messages: request.messages.map((m) =>
          m.images?.length
            ? {
                role: m.role,
                content: [
                  ...m.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mediaType, data: i.data } })),
                  { type: "text" as const, text: m.content },
                ],
              }
            : { role: m.role, content: m.content },
        ),
        ...(request.jsonSchema ? { output_config: { format: { type: "json_schema", schema: request.jsonSchema.schema } } } : {}),
      } as Anthropic.MessageCreateParamsNonStreaming;
      if (request.onText) return await this.stream(params, request);
      const response = await this.client.messages.create(params, { signal: request.signal });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return {
        provider: this.provider,
        model: response.model,
        text,
        json: request.jsonSchema ? parseJsonOutput(text) : undefined,
        stopReason: mapStopReason(response.stop_reason),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
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
    const usage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of events) {
      if (event.type === "message_start") {
        model = event.message.model;
        usage.inputTokens = event.message.usage.input_tokens;
        usage.outputTokens = event.message.usage.output_tokens;
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        request.onText!(event.delta.text);
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason;
        // Cumulative output tokens of the whole message.
        usage.outputTokens = event.usage.output_tokens;
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

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
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
