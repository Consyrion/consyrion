import { createHash } from "node:crypto";
import OpenAI from "openai";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import { isCouncilCapableModel } from "../model-filter";
import type { DiscoveredModel, GenerateRequest, GenerateResult, ProviderAdapter, ProviderId, StopReason } from "../types";

export type CompatibleProviderId = Extract<ProviderId, "deepseek" | "glm" | "kimi" | "qwen" | "xai">;

export interface CompatibleProvider {
  name: string;
  /**
   * Endpoints in order of preference. Keys of these providers are region-locked (international vs. China
   * mainland); a key rejected by one endpoint with 401/403 is tried against the next one.
   */
  baseUrls: string[];
  /** Completion limit requested at most; coding tasks write whole files and need room. */
  maxOutput: number;
}

/** Used again when a provider rejects a larger completion limit (older models cap at 8K). */
const FALLBACK_OUTPUT = 8_192;

/** OpenAI-compatible providers (Chat Completions + JSON mode). Endpoints from the providers' own docs. */
export const COMPATIBLE_PROVIDERS: Record<CompatibleProviderId, CompatibleProvider> = {
  deepseek: { name: "DeepSeek", baseUrls: ["https://api.deepseek.com"], maxOutput: 32_768 },
  glm: { name: "Z.ai GLM", baseUrls: ["https://api.z.ai/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4"], maxOutput: 32_768 },
  kimi: { name: "Moonshot Kimi", baseUrls: ["https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1"], maxOutput: 32_768 },
  xai: { name: "xAI Grok", baseUrls: ["https://api.x.ai/v1"], maxOutput: 32_768 },
  qwen: {
    name: "Alibaba Qwen",
    baseUrls: ["https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
    maxOutput: 32_768,
  },
};

/** Endpoint that last accepted a key, keyed by a hash of provider + key (the key itself is never stored). */
const acceptedEndpoint = new Map<string, number>();

export interface OpenAICompatibleOptions {
  apiKey: string;
  timeoutMs?: number;
  /** Test seam: one client used for every endpoint. */
  client?: OpenAI;
}

/**
 * Adapter for providers that speak the OpenAI Chat Completions format without strict JSON schema support.
 * Structured output uses JSON mode: the schema goes into the system prompt and the answer is validated by the
 * caller like for every other provider.
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider: CompatibleProviderId;
  private readonly config: CompatibleProvider;
  private readonly clients: OpenAI[];
  private readonly cacheKey: string;

  constructor(provider: CompatibleProviderId, options: OpenAICompatibleOptions) {
    this.provider = provider;
    this.config = COMPATIBLE_PROVIDERS[provider];
    this.clients = options.client
      ? [options.client]
      : this.config.baseUrls.map(
          (baseURL) => new OpenAI({ apiKey: options.apiKey, baseURL, maxRetries: 0, timeout: options.timeoutMs ?? SDK_BACKSTOP_TIMEOUT_MS }),
        );
    this.cacheKey = createHash("sha256").update(`${provider}:${options.apiKey}`).digest("hex");
  }

  /** Runs `call` against the endpoint that accepted this key before, falling back across regions on 401/403. */
  private async withEndpoint<T>(call: (client: OpenAI) => Promise<T>): Promise<T> {
    const start = acceptedEndpoint.get(this.cacheKey) ?? 0;
    const order = [...this.clients.keys()].map((i) => (start + i) % this.clients.length);
    let rejected: unknown;
    for (const index of order) {
      try {
        const result = await call(this.clients[index]!);
        acceptedEndpoint.set(this.cacheKey, index);
        return result;
      } catch (error) {
        if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) {
          rejected = error;
          continue;
        }
        throw error;
      }
    }
    throw rejected;
  }

  async listModels(signal?: AbortSignal): Promise<DiscoveredModel[]> {
    try {
      return await this.withEndpoint(async (client) => {
        const models: DiscoveredModel[] = [];
        try {
          for await (const model of client.models.list({ signal })) {
            // These endpoints also list image, video and speech models (Grok Imagine, CogView, Wan, …) (#118).
            if (!isCouncilCapableModel(model.id)) continue;
            models.push({
              provider: this.provider,
              modelId: model.id,
              displayName: model.id,
              contextWindow: null,
              maxOutputTokens: this.config.maxOutput,
              supportsStructuredOutput: false,
            });
          }
        } catch (error) {
          // The key was accepted (auth runs before routing) but there is no models endpoint: no list to offer,
          // model ids are added manually in the team configuration.
          if (error instanceof OpenAI.APIError && error.status === 404) return [];
          throw error;
        }
        return models;
      });
    } catch (error) {
      throw this.normalize(error, signal);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const schemaInstruction = request.jsonSchema
      ? `\n\nRespond with a single json object that matches this JSON Schema exactly (all properties required, no extra properties):\n${JSON.stringify(request.jsonSchema.schema)}`
      : "";
    try {
      const limit = Math.min(request.maxOutputTokens, this.config.maxOutput);
      const body = (maxTokens: number) => ({
        model: request.model,
        max_tokens: maxTokens,
        messages: [
          ...(request.system || schemaInstruction ? [{ role: "system" as const, content: `${request.system ?? ""}${schemaInstruction}` }] : []),
          ...request.messages.map((m) =>
            m.images?.length && m.role === "user"
              ? {
                  role: m.role,
                  content: [
                    ...m.images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mediaType};base64,${i.data}` } })),
                    { type: "text" as const, text: m.content },
                  ],
                }
              : { role: m.role, content: m.content },
          ),
        ],
        ...(request.jsonSchema ? { response_format: { type: "json_object" as const } } : {}),
      });
      const call = (maxTokens: number): Promise<OpenAI.Chat.Completions.ChatCompletion> =>
        this.withEndpoint((client) =>
          request.onText ? this.stream(client, body(maxTokens), request) : client.chat.completions.create(body(maxTokens), { signal: request.signal }),
        );
      let response;
      try {
        response = await call(limit);
      } catch (error) {
        // An older model with a smaller completion limit answers 400 – ask again within the classic 8K.
        if (
          limit > FALLBACK_OUTPUT &&
          error instanceof OpenAI.APIError &&
          error.status === 400 &&
          /max_tokens|max_completion_tokens|output/i.test(error.message)
        ) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "completion limit rejected, falling back",
              provider: this.provider,
              model: request.model,
              requested: limit,
              fallback: FALLBACK_OUTPUT,
            }),
          );
          response = await call(FALLBACK_OUTPUT);
        } else throw error;
      }
      const choice = response.choices[0];
      const text = choice?.message?.content ?? "";
      const stopReason = mapFinish(choice?.finish_reason);
      return {
        provider: this.provider,
        model: response.model,
        text,
        json: request.jsonSchema && stopReason !== "refusal" ? parseJsonOutput(text) : undefined,
        stopReason,
        usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
      };
    } catch (error) {
      throw this.normalize(error, request.signal);
    }
  }

  /**
   * Streaming (#284): content deltas go to `onText`; the usage comes with the last chunk (`stream_options.include_usage`).
   * The chunks are folded back into one ChatCompletion so the caller handles both paths the same way.
   */
  private async stream(
    client: OpenAI,
    body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    request: GenerateRequest,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const chunks = await client.chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } }, { signal: request.signal });
    let content = "";
    let model = body.model;
    let finish: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] | null = null;
    let usage: OpenAI.Completions.CompletionUsage | undefined;
    for await (const chunk of chunks) {
      model = chunk.model || model;
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content ?? "";
      if (delta) {
        content += delta;
        request.onText!(delta);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }
    // The SDK streams end quietly when the signal aborts (live test 06.11.26) – report it as a cancellation.
    if (request.signal?.aborted) throw abortError(this.provider, request.signal.reason, request.signal);
    return {
      id: "stream",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          finish_reason: finish as OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"],
          logprobs: null,
          message: { role: "assistant", content, refusal: null },
        },
      ],
      usage,
    };
  }

  private normalize(error: unknown, signal?: AbortSignal): ProviderError {
    const name = this.config.name;
    if (error instanceof ProviderError) return error;
    if (error instanceof OpenAI.APIUserAbortError || isAbortError(error)) return abortError(this.provider, error, signal);
    if (error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(this.provider, "timeout", "Request timed out");
    if (error instanceof OpenAI.APIConnectionError) return new ProviderError(this.provider, "unavailable", `Could not reach ${name}`);
    if (error instanceof OpenAI.APIError) {
      // 402 = account balance used up (DeepSeek and others).
      const kind = error.status === 402 ? "auth" : kindFromStatus(error.status);
      return new ProviderError(
        this.provider,
        kind,
        `${name} API error ${error.status ?? ""}${error.status === 402 ? " (insufficient balance)" : ""}`.trim(),
        error.status,
      );
    }
    return new ProviderError(this.provider, "unknown", `Unexpected ${name} adapter error`);
  }
}

function mapFinish(reason: string | null | undefined): StopReason {
  if (reason === "stop") return "completed";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter" || reason === "sensitive") return "refusal";
  return "other";
}
