import { COMPATIBLE_PROVIDERS, OpenAICompatibleAdapter, type OpenAICompatibleOptions } from "./openai-compatible";

export type DeepSeekAdapterOptions = OpenAICompatibleOptions;

export const DEEPSEEK_BASE_URL = COMPATIBLE_PROVIDERS.deepseek.baseUrls[0]!;

/** DeepSeek: OpenAI-compatible Chat Completions with JSON mode (see `OpenAICompatibleAdapter`). */
export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor(options: DeepSeekAdapterOptions) {
    super("deepseek", options);
  }
}
