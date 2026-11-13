/**
 * Reservations about a recommendation (QA 12.11.26 + ChatGPT review of PR #631): one rule for the Final Verdict hero and
 * the decision report, so the screen and the PDF never disagree. It never changes the verdict – it only says what still
 * qualifies it: open critical and high objections against the recommended proposal, and low confidence.
 */
export interface CautionObjection {
  proposalId: string;
  severity: string;
  status: string;
  moot?: unknown;
}

export interface VerdictCaution {
  openCritical: number;
  openHigh: number;
  lowConfidence: boolean;
}

/** Objection states that still count against a proposal; a moot one (raised against a replaced revision) does not. */
const OPEN_STATES = new Set(["open", "accepted", "unresolved"]);

export function verdictCaution(input: {
  recommendedProposalId: string | null | undefined;
  objections: ReadonlyArray<CautionObjection>;
  /** The stored verdict confidence; verdicts from before confidence tracking have none. */
  confidence?: string | null;
  /** Used only for those older verdicts: stored confidence issues plus evaluators without usable scores. */
  legacyIssueCount?: number;
}): VerdictCaution {
  const open = input.recommendedProposalId
    ? input.objections.filter((o) => o.proposalId === input.recommendedProposalId && OPEN_STATES.has(o.status) && !o.moot)
    : [];
  const lowConfidence = input.confidence != null ? input.confidence === "low" : (input.legacyIssueCount ?? 0) > 0;
  return {
    openCritical: open.filter((o) => o.severity === "critical").length,
    openHigh: open.filter((o) => o.severity === "high").length,
    lowConfidence,
  };
}

export function hasCaution(c: VerdictCaution): boolean {
  return c.openCritical + c.openHigh > 0 || c.lowConfidence;
}
