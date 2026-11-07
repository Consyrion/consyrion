import type { NodeState } from "./council-network";

export const PROVIDER_COLOR: Record<string, string> = {
  openai: "#22d3ee",
  anthropic: "#8b5cf6",
  google: "#2ee6a8",
  deepseek: "#d946ef",
  glm: "#2f7bff",
  kimi: "#fbbf24",
  qwen: "#f97316",
  xai: "#e2e8f0",
};

export const PROVIDER_NAME: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  glm: "Z.ai GLM",
  kimi: "Kimi",
  qwen: "Qwen",
  xai: "Grok",
};

/** Real per-model figures for the hover card; all optional so the graphic also works without them. */
export interface ActivityNodeDetails {
  roles: string[];
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  failureReason?: string | null;
  /** Project overview, "all sessions": in how many council sessions this model took part. */
  sessions?: number;
}

export interface ActivityNode {
  id: string;
  provider: string;
  model: string;
  state: NodeState;
  details?: ActivityNodeDetails;
}
