import OpenAI from "openai";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import { isCouncilCapableModel } from "../model-filter";
import type { DiscoveredModel, GenerateRequest, GenerateResult, ProviderAdapter, StopReason } from "../types";

export interface OpenAIAdapterOptions {
  apiKey: string;
  timeoutMs?: number;
  client?: OpenAI;
}

// The models endpoint also lists audio, image, video and moderation models; isCouncilCapableModel drops them.

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(options: OpenAIAdapterOptions) {
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? SDK_BACKSTOP_TIMEOUT_MS });
  }

  async listModels(signal?: AbortSignal): Promise<DiscoveredModel[]> {
    try {
      const listed: Array<{ model: DiscoveredModel; created: number }> = [];
      for await (const model of this.client.models.list({ signal })) {
        if (!isCouncilCapableModel(model.id)) continue;
        // The endpoint does not report limits or capabilities, so they stay unknown (null).
        listed.push({ model: { provider: this.provider, modelId: model.id, displayName: model.id, contextWindow: null, maxOutputTokens: null, supportsStructuredOutput: null }, created: model.created ?? 0 });
      }
      // Newest first (the provider's creation timestamp), so current models are not buried under legacy ones.
      return listed.sort((a, b) => b.created - a.created || a.model.modelId.localeCompare(b.model.modelId)).map((entry) => entry.model);
    } catch (error) {
      throw this.normalize(error, signal);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.responses.create(
        {
          model: request.model,
          max_output_tokens: request.maxOutputTokens,
          ...(request.system ? { instructions: request.system } : {}),
          input: request.messages.map((message) =>
            message.images?.length && message.role === "user"
              ? {
                  role: message.role,
                  content: [
                    ...message.images.map((i) => ({ type: "input_image" as const, image_url: `data:${i.mediaType};base64,${i.data}`, detail: "auto" as const })),
                    { type: "input_text" as const, text: message.content },
                  ],
                }
              : { role: message.role, content: message.content },
          ),
          ...(request.jsonSchema
            ? { text: { format: { type: "json_schema" as const, name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: true } } }
            : {}),
        },
        { signal: request.signal },
      );
      const refused = response.output.some(
        (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      const text = response.output_text ?? "";
      return {
        provider: this.provider,
        model: response.model,
        text,
        json: request.jsonSchema && !refused ? parseJsonOutput(text) : undefined,
        stopReason: refused ? "refusal" : mapStatus(response.status, response.incomplete_details?.reason),
        usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      };
    } catch (error) {
      throw this.normalize(error, request.signal);
    }
  }

  private normalize(error: unknown, signal?: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error;
    if (error instanceof OpenAI.APIUserAbortError || isAbortError(error)) return abortError(this.provider, error, signal);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(this.provider, "timeout", "Request timed out");
    if (error instanceof OpenAI.APIConnectionError) return new ProviderError(this.provider, "unavailable", "Could not reach OpenAI");
    if (error instanceof OpenAI.APIError) {
      return new ProviderError(this.provider, kindFromStatus(error.status), `OpenAI API error ${error.status ?? ""}`.trim(), error.status);
    }
    return new ProviderError(this.provider, "unknown", "Unexpected OpenAI adapter error");
  }
}

function mapStatus(status: string | undefined, incompleteReason: string | undefined): StopReason {
  if (status === "completed") return "completed";
  if (status === "incomplete" && incompleteReason === "max_output_tokens") return "max_tokens";
  if (status === "incomplete" && incompleteReason === "content_filter") return "refusal";
  return "other";
}
