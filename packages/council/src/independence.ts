import { independenceKey } from "@consyrium/core";

/**
 * Independence group per participant (user decision 08.11.26): instances of one model through different keys share a
 * group and are ONE voice for independence, majorities and the minimum review breadth (#249).
 */
export function groupsOf(participants: ReadonlyArray<{ id: string; provider: string; modelId: string }>): Record<string, string> {
  return Object.fromEntries(participants.map((p) => [p.id, independenceKey(p.provider, p.modelId)]));
}
