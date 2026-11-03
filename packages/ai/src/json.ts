function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parses model JSON output. Returns undefined instead of throwing so callers can record invalid output.
 * JSON-mode providers (Kimi, GLM, Qwen, DeepSeek) sometimes wrap the object in a ```json fence, put a
 * <think>…</think> block or a short sentence before it. Those wrappers are removed; the object itself is still
 * validated against the schema by the caller, so nothing is invented here.
 */
export function parseJsonOutput(text: string): unknown {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!withoutThinking) return undefined;
  const direct = tryParse(withoutThinking);
  if (direct !== undefined) return direct;
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParse(fenced.trim());
    if (parsed !== undefined) return parsed;
  }
  // Outermost object in surrounding prose.
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(withoutThinking.slice(start, end + 1));
  return undefined;
}
