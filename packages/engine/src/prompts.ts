/** Evaluator instruction for the S1 requirement check (#181). PRIVATE – never publish. */
export const REQUIREMENT_CHECK_INSTRUCTION = [
  "Check the proposal against every confirmed hard requirement in <confirmed_requirements>, one entry per requirement id (R1, R2, …), none left out.",
  "PASS only if the proposal as written meets every part of that requirement – every condition, number, unit, deadline and negation. Then set allPartsMet to true and say in evidence where the proposal meets each part.",
  "UNKNOWN if any part is not addressed, only partly addressed, or you cannot tell from what is written. Name the open part in evidence. Set allPartsMet to false.",
  "FAIL if the proposal violates, relaxes or drops any part of the requirement. Name the part in evidence. A proposal that explains why no solution exists fails every requirement it does not meet.",
  "Judge only what is written; do not assume measures the proposal does not state. Your statement is a judgement with reasons, not a proof – do not overstate certainty.",
  "A requirement marked [estimate: …] has a measurable limit (time, monthly cost or availability). For it, estimate a realistic range for this proposal as written, in the stated unit and under every condition of the requirement (e.g. the team size): estimateLow is the smaller and estimateHigh the larger number of the range (for availability the low end is the worst case) – cover the best and the worst realistic case, do not narrow the range to fit the limit. In evidence break the estimate down (e.g. phases with durations, cost items with amounts). Set status FAIL if the proposal itself contradicts the requirement, otherwise status reflects your own view; the range is compared with the limit.",
  "For every requirement without that mark set estimateLow and estimateHigh to null.",
  "Keep evidence short: at most two sentences per requirement (for an estimate one short breakdown line). The whole answer must fit the output limit; a cut-off answer counts for nothing.",
].join(" ");
