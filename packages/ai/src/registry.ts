import { AnthropicAdapter } from "./adapters/anthropic";
import { DeepSeekAdapter } from "./adapters/deepseek";
import { GoogleAdapter } from "./adapters/google";
import { OpenAIAdapter } from "./adapters/openai";
import { OpenAICompatibleAdapter } from "./adapters/openai-compatible";
import { ProviderError } from "./errors";
import { timeoutSignal } from "./retry";
import type { DiscoveredModel, ProviderAdapter, ProviderId } from "./types";

export type AdapterFactory = (provider: ProviderId, apiKey: string) => ProviderAdapter;

export const createAdapter: AdapterFactory = (provider, apiKey) => {
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter({ apiKey });
    case "openai":
      return new OpenAIAdapter({ apiKey });
    case "google":
      return new GoogleAdapter({ apiKey });
    case "deepseek":
      return new DeepSeekAdapter({ apiKey });
    case "glm":
    case "kimi":
    case "qwen":
    case "xai":
      return new OpenAICompatibleAdapter(provider, { apiKey });
  }
};

export interface ProviderModels {
  provider: ProviderId;
  models: DiscoveredModel[];
  /** Set when discovery failed; the other providers are still returned. */
  error: { kind: ProviderError["kind"]; message: string } | null;
}

/**
 * Discovers the models each configured provider actually offers. One failing provider does not
 * hide the others, so the UI can show "key invalid" next to working providers.
 */
export async function discoverModels(
  credentials: ReadonlyArray<{ provider: ProviderId; apiKey: string }>,
  options: { factory?: AdapterFactory; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProviderModels[]> {
  const factory = options.factory ?? createAdapter;
  return Promise.all(
    credentials.map(async ({ provider, apiKey }): Promise<ProviderModels> => {
      try {
        const models = await factory(provider, apiKey).listModels(timeoutSignal(options.timeoutMs ?? 15_000, options.signal));
        return { provider, models, error: null };
      } catch (error) {
        const normalized = error instanceof ProviderError ? error : new ProviderError(provider, "unknown", "Model discovery failed");
        return { provider, models: [], error: { kind: normalized.kind, message: normalized.message } };
      }
    }),
  );
}
