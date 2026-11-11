import { DomainError } from "@consyrium/core";
import {
  assertCanEvaluateSession,
  assertDecisionApprovable,
  assertDecisionRoundBinding,
  checkApprovalAfterMeasurement,
  checkPrototypeEligibility,
  latestMeasurements,
  sessionGateVersions,
} from "@consyrium/council";
import { schema, type Database } from "@consyrium/db";
import { and, eq } from "drizzle-orm";

/**
 * Whether an approval may (still) be built (#121, #181 stage 1/1b, #190). Checked when the Execution Council starts
 * and again whenever a build job runs or resumes, so a release that was rolled back to never continues a build it could
 * not have started: only an implementable solution of the current decision, in a format version this release supports,
 * bound to the same confirmed requirement list as session and approval. A missing decision is refused.
 */
export async function assertApprovalBuildable(
  db: Database,
  session: Pick<typeof schema.councilSession.$inferSelect, "id" | "organizationId" | "status" | "requirementListId">,
  approval: Pick<typeof schema.humanApproval.$inferSelect, "decisionId" | "selectedProposalId" | "requirementListId"> & {
    action?: (typeof schema.humanApproval.$inferSelect)["action"];
  },
) {
  // #249 part 2 (variant B): a marked prototype/measurement build runs while the verdict still waits for a decision.
  const prototype = approval.action === "approve_prototype";
  if (prototype ? !["awaiting_approval", "approved"].includes(session.status) : session.status !== "approved")
    throw new DomainError("CONFLICT", "The Execution Council needs an approved decision");
  if (!approval.selectedProposalId) throw new DomainError("CONFLICT", "No approved proposal found");
  assertCanEvaluateSession(await sessionGateVersions(db, session.id));
  const [decision] = await db
    .select({
      gateVersion: schema.finalDecision.gateVersion,
      outcome: schema.finalDecision.outcome,
      recommendedProposalId: schema.finalDecision.recommendedProposalId,
      matrix: schema.finalDecision.matrix,
      requirementListId: schema.finalDecision.requirementListId,
      supersededAt: schema.finalDecision.supersededAt,
    })
    .from(schema.finalDecision)
    .where(
      and(
        eq(schema.finalDecision.id, approval.decisionId),
        eq(schema.finalDecision.sessionId, session.id),
        eq(schema.finalDecision.organizationId, session.organizationId),
      ),
    );
  if (!decision) throw new DomainError("CONFLICT", "The approved decision is missing; it cannot be built.");
  if (decision.supersededAt) throw new DomainError("CONFLICT", "The approved verdict is no longer the current verdict of this session");
  if (prototype) {
    const eligible = checkPrototypeEligibility(decision, approval.selectedProposalId);
    if (!eligible.ok) throw new DomainError("CONFLICT", eligible.reason);
  } else if (approval.action === "approve_after_measurement") {
    // #249 gate 2: re-checked on every run – a later "not met" measurement stops the build.
    const check = checkApprovalAfterMeasurement(
      decision,
      approval.selectedProposalId,
      await latestMeasurements(db, approval.decisionId, approval.selectedProposalId),
    );
    if (!check.ok) throw new DomainError("CONFLICT", check.reason);
  } else assertDecisionApprovable(decision, approval.selectedProposalId);
  await assertDecisionRoundBinding(db, session.id, decision);
  // Binding (#190): session, verdict and approval must refer to the same confirmed requirement list version, so an
  // approval of one list can never build a state reached on another.
  const lists = new Set([session.requirementListId ?? null, decision.requirementListId ?? null, approval.requirementListId ?? null]);
  if (lists.size !== 1) throw new DomainError("CONFLICT", "The approval belongs to a different requirement list version than this session's verdict");
}
