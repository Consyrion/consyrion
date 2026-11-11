import type { RequirementItem } from "@consyrium/core";
import { and, gte } from "drizzle-orm";
import type { Database } from "../client";
import { finalDecision, requirementList } from "../schema";
import { assertPlatformAdmin, type PlatformAdminContext } from "./feedback";

/**
 * #245 measure, read-only and platform-wide (platform admins only): counts, never text. Over the confirmed requirement
 * lists and gate-version-2 verdicts of the last `days` days:
 * - proposed : kept – statements the intake found (kept from a candidate + excluded) per statement taken over;
 *   31.10.26 the self-improvement project was 21 : 6, target ≤ 2 : 1;
 * - verdicts without a qualified proposal where some proposal failed only on ONE requirement nobody could confirm
 *   (UNKNOWN) – the share #245 wants to bring down.
 */
export interface IntakeMetrics {
  days: number;
  lists: number;
  proposed: number;
  kept: number;
  userAdded: number;
  splitParts: number;
  verdicts: number;
  withoutQualified: number;
  onlyOneUnconfirmable: number;
}

type GateEntry = { feasibility?: unknown; requirements?: Array<{ status?: unknown }> };

/** Some proposal is blocked by exactly one requirement, and that one is UNKNOWN (no evaluator could confirm it). */
export function blockedOnlyByOneUnconfirmable(matrix: unknown): boolean {
  const proposals = (matrix as { requirementGate?: { proposals?: GateEntry[] } } | null)?.requirementGate?.proposals;
  if (!Array.isArray(proposals) || proposals.some((p) => p.feasibility === "qualified")) return false;
  return proposals.some((p) => {
    const notPassed = (p.requirements ?? []).filter((r) => r.status !== "PASS");
    return notPassed.length === 1 && notPassed[0]!.status === "UNKNOWN";
  });
}

export async function requirementIntakeMetrics(db: Database, admin: PlatformAdminContext, options: { days?: number; now?: Date } = {}): Promise<IntakeMetrics> {
  assertPlatformAdmin(admin);
  const days = Math.min(365, Math.max(1, Math.floor(options.days ?? 30)));
  const since = new Date((options.now ?? new Date()).getTime() - days * 86_400_000);
  const lists = await db
    .select({ items: requirementList.items, excluded: requirementList.excluded })
    .from(requirementList)
    .where(gte(requirementList.confirmedAt, since));
  let kept = 0;
  let userAdded = 0;
  let splitParts = 0;
  let excluded = 0;
  for (const list of lists) {
    const items = (list.items ?? []) as RequirementItem[];
    // Parts of one split share their candidate: the statement counts once as kept.
    kept += new Set(items.filter((i) => i.candidateKey).map((i) => i.candidateKey)).size;
    userAdded += items.filter((i) => !i.candidateKey).length;
    splitParts += items.filter((i) => i.splitFrom).length;
    excluded += (list.excluded ?? []).length;
  }
  const verdicts = await db
    .select({ outcome: finalDecision.outcome, matrix: finalDecision.matrix })
    .from(finalDecision)
    .where(and(gte(finalDecision.createdAt, since), gte(finalDecision.gateVersion, 2)));
  const withoutQualified = verdicts.filter((v) => v.outcome !== "recommended" && v.outcome !== "tie");
  return {
    days,
    lists: lists.length,
    proposed: kept + excluded,
    kept,
    userAdded,
    splitParts,
    verdicts: verdicts.length,
    withoutQualified: withoutQualified.length,
    onlyOneUnconfirmable: withoutQualified.filter((v) => blockedOnlyByOneUnconfirmable(v.matrix)).length,
  };
}
