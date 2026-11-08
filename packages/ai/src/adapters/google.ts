import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { abortError, isAbortError, kindFromStatus, ProviderError } from "../errors";
import { SDK_BACKSTOP_TIMEOUT_MS } from "../retry";
import { parseJsonOutput } from "../json";
import { ensureToolCallIds, parseToolArgs } from "../tools";
import { isCouncilCapableModel } from "../model-filter";
import { tokenUsage, type DiscoveredModel, type GenerateRequest, type GenerateResult, type ProviderAdapter, type StopReason } from "../types";

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
      const params = {
        model: request.model,
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [
            ...(message.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })),
            // Native tool calling (#284): results as functionResponse parts, calls as functionCall parts.
            ...(message.toolResults ?? []).map((r) => ({ functionResponse: { id: r.callId, name: r.name, response: { output: r.content } } })),
            ...(message.content || !(message.toolCalls?.length || message.toolResults?.length) ? [{ text: message.content }] : []),
            ...(message.toolCalls ?? []).map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.args } })),
          ],
        })),
        config: {
          maxOutputTokens: request.maxOutputTokens,
          abortSignal: request.signal,
          httpOptions: { timeout: this.timeoutMs },
          ...(request.system ? { systemInstruction: request.system } : {}),
          ...(request.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: request.jsonSchema.schema } : {}),
          ...(request.tools?.length
            ? {
                tools: [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
              }
            : {}),
        },
      };
      let response;
      let text: string;
      let blockedInStream = false;
      // Tools use the non-streaming call (#284); the text then reaches onText once at the end.
      const streaming = Boolean(request.onText && !request.tools?.length);
      if (streaming && request.onText) {
        // Streaming (#284): every chunk is a partial response; finish reason and usage arrive with the last one.
        text = "";
        for await (const chunk of await this.client.models.generateContentStream(params)) {
          const delta = chunk.text ?? "";
          if (delta) {
            text += delta;
            request.onText(delta);
          }
          if (chunk.promptFeedback?.blockReason) blockedInStream = true;
          response = chunk;
        }
        if (request.signal?.aborted) throw abortError(this.provider, request.signal.reason, request.signal);
        if (!response) throw new ProviderError(this.provider, "unknown", "Gemini stream ended without a response");
      } else {
        response = await this.client.models.generateContent(params);
        // With tools: text parts only (the SDK's `text` getter warns when function calls are mixed in). Without tools
        // unchanged – councils keep reading `text`.
        text = request.tools?.length
          ? (response.candidates?.[0]?.content?.parts ?? []).map((p) => (typeof p.text === "string" && !p.thought ? p.text : "")).join("")
          : (response.text ?? "");
        if (request.onText && text) request.onText(text);
      }
      const toolCalls = ensureToolCallIds(
        (response.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => p.functionCall?.name)
          .map((p) => ({ id: p.functionCall!.id, name: p.functionCall!.name!, args: parseToolArgs(p.functionCall!.args) })),
        "call",
      );
      const finish = response.candidates?.[0]?.finishReason;
      const promptBlocked = blockedInStream || Boolean(response.promptFeedback?.blockReason);
      const stopReason: StopReason =
        promptBlocked || (finish && BLOCKED.has(finish))
          ? "refusal"
          : finish === FinishReason.MAX_TOKENS
            ? "max_tokens"
            : finish === FinishReason.STOP
              ? "completed"
              : "other";
      return {
        provider: this.provider,
        model: response.modelVersion ?? request.model,
        text,
        json: request.jsonSchema && stopReason !== "refusal" ? parseJsonOutput(text) : undefined,
        stopReason,
        // promptTokenCount includes cached content (#244); cachedContentTokenCount is the cached part.
        usage: {
          ...tokenUsage(0, 0, response.usageMetadata?.cachedContentTokenCount),
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
        },
        ...(request.tools?.length ? { toolCalls } : {}),
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
