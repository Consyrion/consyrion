/**
 * Token estimates booked against the user's assistant limits before a call (#519) – shared by the server (reservation)
 * and the panel (hint when a limit is too small for one question). Roughly 4 characters per token, the system prompt
 * and one tool round, and a third of the output cap (3,000). Deliberately on the high side of what live answers used
 * (08.11.26: estimate 7,046 vs. 1,527–2,758 real for short answers); the reservation is replaced by the real tokens.
 */
const SYSTEM_TOKENS = 3_000;
const OUTPUT_SHARE = 1_000;

export function estimateAnswerTokens(historyChars: number, questionChars: number): number {
  return (SYSTEM_TOKENS + Math.ceil((historyChars + questionChars) / 4)) * 2 + OUTPUT_SHARE;
}

/** A one-call summary of a transcript (no tools). */
export function estimateSummaryTokens(transcriptChars: number): number {
  return 600 + Math.ceil(Math.min(transcriptChars, 68_000) / 4) + 1_200;
}

/** What a short new question reserves – a limit below this lets no question through. */
export const MIN_QUESTION_TOKENS = estimateAnswerTokens(0, 200);
