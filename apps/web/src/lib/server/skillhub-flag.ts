import "server-only";
import { DomainError } from "@consyrium/core";

/**
 * Feature flag for SkillHub submissions (#368): `SKILLHUB_PUBLISH=1` turns on the "Publish…" button and the submission
 * routes. Off by default, enforced on the server – it is switched on only after the admin queue (PR 5) is live and
 * checked, so no submission can wait in a queue nobody sees. Withdrawing a public skill always works.
 */
export function skillHubPublishEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ["1", "true", "on"].includes((env.SKILLHUB_PUBLISH ?? "").trim().toLowerCase());
}

export function assertSkillHubPublishEnabled(env: Record<string, string | undefined> = process.env): void {
  if (!skillHubPublishEnabled(env)) throw new DomainError("NOT_FOUND", "Not found");
}
