/**
 * Independence groups (user decision 08.11.26): the same model may join a council several times through different API
 * keys or accounts, but instances of one model are never independent of each other. For independence, majorities and
 * the minimum review breadth (#249) every instance of a model counts as ONE voice; a model never counts as a foreign
 * reviewer of its own instances.
 *
 * The group is the provider plus the model id, normalised: lower case, without a trailing date or version stamp
 * ("-20261001", "-2026-10-01", "@20261001", "-latest", "-preview-…" dates), so a dated snapshot of a model and its alias
 * land in the same group. Different model sizes or versions (opus vs. sonnet, 5-5 vs. 5-1) stay different groups.
 */
export function independenceKey(provider: string, modelId: string): string {
  let id = modelId.trim().toLowerCase();
  // A provider prefix inside the id ("anthropic/claude-…", "models/gemini-…") does not make another model.
  id = id.replace(/^(?:models|[a-z0-9-]+)\//, "");
  for (;;) {
    const next = id
      .replace(/[@-](?:\d{8}|\d{4}-\d{2}-\d{2}|\d{6})$/, "") // date stamps: 20261001, 2026-10-01, 261001
      .replace(/-(?:latest|v\d+(?::\d+)?)$/, ""); // aliases and API revision suffixes
    if (next === id) break;
    id = next;
  }
  return `${provider.trim().toLowerCase()}:${id}`;
}

/** Number of independent groups among participants. */
export function independentGroupCount(participants: ReadonlyArray<{ provider: string; modelId: string }>): number {
  return new Set(participants.map((p) => independenceKey(p.provider, p.modelId))).size;
}
