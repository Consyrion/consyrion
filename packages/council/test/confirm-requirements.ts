import { confirmRequirementList, proposeRequirementList, type ActorContext, type Database } from "@consyrion/db";

/**
 * Test and demo helper (#190): confirms the requirement list exactly as proposed – what a user does who reviews the
 * list and accepts it unchanged. Tests that are about the intake itself call the repository functions directly.
 */
export async function confirmProposedRequirements(db: Database, actor: ActorContext, projectId: string) {
  const proposal = await proposeRequirementList(db, actor, projectId);
  if (proposal.current && proposal.latest) return proposal.latest;
  return confirmRequirementList(db, actor, projectId, {
    sourceHash: proposal.source.hash,
    items: proposal.items.map((i) => ({ text: i.text, candidateKey: i.candidateKey, splitFrom: i.splitFrom ?? null })),
    // #227: statements put to the user are excluded with the suggested reason – what the older default did.
    excluded: [...proposal.excluded, ...proposal.toDecide.map((e) => ({ candidateKey: e.candidateKey, reason: e.suggestedReason }))].map((e) => ({
      candidateKey: e.candidateKey,
      reason: e.reason,
    })),
    noHardRequirements: proposal.items.length === 0,
  });
}
