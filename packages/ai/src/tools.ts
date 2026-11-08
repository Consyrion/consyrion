import type { ToolCall } from "./types";

/**
 * Helpers for native tool calling (#284). Provider responses carry the arguments as a JSON string (OpenAI, compatible
 * providers) or an object (Anthropic, Gemini); both end up as a plain object. Broken JSON becomes `{}` with the raw text
 * kept, so the caller can tell the model instead of crashing.
 */
export function parseToolArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { _invalid_json: value.slice(0, 2_000) };
  }
}

/** Gemini returns calls without ids; numbered ids keep the results matched to the calls. */
export function ensureToolCallIds(calls: Array<Omit<ToolCall, "id"> & { id?: string | null }>, prefix: string): ToolCall[] {
  return calls.map((c, i) => ({ id: c.id || `${prefix}_${i}`, name: c.name, args: c.args }));
}
