/**
 * #477: the workflow waits for a human, but no proposal can be approved. One rule for the session header, the verdict
 * status and every report format (#268) – the header says "awaiting your review · no approvable proposal" instead of
 * "awaiting approval". Only reads what the server decided.
 */
export function awaitingReviewWithoutApproval(
  sessionStatus: string,
  decisionStatus: { approvable: boolean; approvableProposalIds?: readonly string[] | null } | null | undefined,
): boolean {
  return (
    sessionStatus === "awaiting_approval" && decisionStatus != null && (!decisionStatus.approvable || (decisionStatus.approvableProposalIds ?? []).length === 0)
  );
}
