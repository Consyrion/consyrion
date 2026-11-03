export const PROVIDER_IDS = ["anthropic", "openai", "google", "deepseek", "glm", "kimi", "qwen", "xai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  glm: "Z.ai GLM",
  kimi: "Moonshot Kimi",
  qwen: "Alibaba Qwen",
  xai: "xAI Grok",
};

/** A model as reported by the provider's own models endpoint. Nothing here is hardcoded. */
export interface DiscoveredModel {
  provider: ProviderId;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsStructuredOutput: boolean | null;
}

export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** An image sent with a user message (base64, no data: prefix). Only for image description, never in a council. */
export interface ImageInput {
  mediaType: ImageMediaType;
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Images before the text of a user message; providers without image input reject the request. */
  images?: ReadonlyArray<ImageInput>;
}

export interface JsonSchemaSpec {
  /** Identifier used by providers that require a schema name (OpenAI). */
  name: string;
  schema: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** When set, the provider is asked for JSON matching this schema and the result is parsed. */
  jsonSchema?: JsonSchemaSpec;
  signal?: AbortSignal;
}

export type StopReason = "completed" | "max_tokens" | "refusal" | "other";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  provider: ProviderId;
  model: string;
  text: string;
  /** Parsed JSON when `jsonSchema` was requested and the output was valid JSON. */
  json: unknown;
  stopReason: StopReason;
  usage: TokenUsage;
}

export interface ProviderAdapter {
  readonly provider: ProviderId;
  listModels(signal?: AbortSignal): Promise<DiscoveredModel[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
