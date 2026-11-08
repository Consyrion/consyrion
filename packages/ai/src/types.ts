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
  /** Native tool calling (#284): the tools an assistant message called (as returned in `GenerateResult.toolCalls`). */
  toolCalls?: ReadonlyArray<ToolCall>;
  /** Native tool calling (#284): results for the previous assistant message's tool calls, sent in a user message. */
  toolResults?: ReadonlyArray<ToolResult>;
}

/** A tool the model may call natively (#284). `parameters` is a JSON Schema object. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call the model made. `id` links the result back (Gemini has no ids: the adapter makes one up). */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The result of one tool call, as text (usually JSON) – data for the model, never instructions. */
export interface ToolResult {
  callId: string;
  name: string;
  content: string;
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
  /**
   * Streaming (#284): when set, the adapter uses the provider's streaming API and calls this with every text chunk as it
   * arrives. The returned result is the same as without streaming (full text, parsed JSON, stop reason, usage from the
   * provider's final event). Councils do not set it.
   */
  onText?: (delta: string) => void;
  /**
   * Native tool calling (#284): tools the model may call. Not combined with `jsonSchema`. With tools the adapter uses
   * the non-streaming API; `onText` then receives the whole text once at the end.
   */
  tools?: ReadonlyArray<ToolDefinition>;
  /**
   * Prompt caching (#244): the beginning of the first user message that stays identical across many calls (a council's
   * brief with its repository context). Adapters whose provider needs an explicit cache marker (Anthropic) set it after
   * this prefix; OpenAI, Gemini and the OpenAI-compatible providers cache identical prefixes automatically. Ignored when
   * the first user message does not start with it.
   */
  cachePrefix?: string;
}

export type StopReason = "completed" | "max_tokens" | "refusal" | "other";

export interface TokenUsage {
  /**
   * All input tokens of the call, **including** the ones served from the provider's prompt cache (#244). OpenAI and
   * Gemini report it this way; the Anthropic adapter adds `cache_read_input_tokens` and `cache_creation_input_tokens`
   * to Anthropic's `input_tokens`, which excludes them. Budgets and costs use this total, so nothing is counted twice.
   */
  inputTokens: number;
  outputTokens: number;
  /**
   * Part of `inputTokens` the provider read from its prompt cache (#244) – usually billed at a fraction of the input
   * price. Only set when the provider reported cached tokens (> 0); absent means none or not reported.
   */
  cachedInputTokens?: number;
}

/** Usage with `cachedInputTokens` only when the provider reported any (keeps results without caching unchanged). */
export function tokenUsage(inputTokens: number, outputTokens: number, cachedInputTokens?: number | null): TokenUsage {
  return cachedInputTokens && cachedInputTokens > 0 ? { inputTokens, outputTokens, cachedInputTokens } : { inputTokens, outputTokens };
}

export interface GenerateResult {
  provider: ProviderId;
  model: string;
  text: string;
  /** Parsed JSON when `jsonSchema` was requested and the output was valid JSON. */
  json: unknown;
  stopReason: StopReason;
  usage: TokenUsage;
  /** Native tool calling (#284): the calls the model made; empty or missing when it answered with text. */
  toolCalls?: ToolCall[];
}

export interface ProviderAdapter {
  readonly provider: ProviderId;
  listModels(signal?: AbortSignal): Promise<DiscoveredModel[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
