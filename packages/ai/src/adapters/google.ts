import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import { isCouncilCapableModel } from "../model-filter";
import type { DiscoveredModel, GenerateRequest, GenerateResult, ProviderAdapter, StopReason } from "../types";

export interface GoogleAdapterOptions {
  apiKey: string;
  timeoutMs?: number;
  client?: GoogleGenAI;
}

const BLOCKED: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.RECITATION,
  FinishReason.SPII,
]);

export class GoogleAdapter implements ProviderAdapter {
  readonly provider = "google" as const;
  private readonly client: GoogleGenAI;
  private readonly timeoutMs: number;

  constructor(options: GoogleAdapterOptions) {
    this.timeoutMs = options.timeoutMs ?? SDK_BACKSTOP_TIMEOUT_MS;
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  async listModels(signal?: AbortSignal): Promise<DiscoveredModel[]> {
    try {
      const pager = await this.client.models.list({ config: { abortSignal: signal, httpOptions: { timeout: this.timeoutMs } } });
      const models: DiscoveredModel[] = [];
      for await (const model of pager) {
        if (!model.name || !model.supportedActions?.includes("generateContent")) continue;
        const modelId = model.name.replace(/^models\//, "");
        if (!isCouncilCapableModel(modelId, model.displayName ?? "")) continue;
        models.push({
          provider: this.provider,
          modelId,
          displayName: model.displayName ?? modelId,
          contextWindow: model.inputTokenLimit ?? null,
          maxOutputTokens: model.outputTokenLimit ?? null,
          supportsStructuredOutput: null,
        });
      }
      return models;
    } catch (error) {
      throw this.normalize(error, signal);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.models.generateContent({
        model: request.model,
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [...(message.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text: message.content }],
        })),
        config: {
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: request.signal,
          httpOptions: { timeout: this.timeoutMs },
          ...(request.system ? { systemInstruction: request.system } : {}),
          ...(request.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: request.jsonSchema.schema } : {}),
        },
      });
      const finish = response.candidates?.[0]?.finishReason;
      const promptBlocked = Boolean(response.promptFeedback?.blockReason);
      const stopReason: StopReason =
        promptBlocked || (finish && BLOCKED.has(finish)) ? "refusal" : finish === FinishReason.MAX_TOKENS ? "max_tokens" : finish === FinishReason.STOP ? "completed" : "other";
      const text = response.text ?? "";
      return {
        provider: this.provider,
        model: response.modelVersion ?? request.model,
        text,
        json: request.jsonSchema && stopReason !== "refusal" ? parseJsonOutput(text) : undefined,
        stopReason,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
        },
      };
    } catch (error) {
      throw this.normalize(error, request.signal);
    }
  }

  private normalize(error: unknown, signal?: AbortSignal): ProviderError {
    if (error instanceof ProviderError) return error;
    if (isAbortError(error)) return abortError(this.provider, error, signal);
    if (error instanceof ApiError) return new ProviderError(this.provider, kindFromStatus(error.status), `Gemini API error ${error.status}`, error.status);
    return new ProviderError(this.provider, "unavailable", "Could not reach Gemini");
  }
}
