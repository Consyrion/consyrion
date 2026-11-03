/**
 * #245: requirements that nobody can confirm before the solution exists – "muss 2–4 Musikern rhythmisch stabiles
 * Zusammenspiel ermöglichen" blocked both OnJam councils, because no evaluator can say PASS for an experience that
 * has not been measured. Detected deterministically and browser-safe; it is only a hint on the confirmation screen.
 * The requirement itself is never changed or softened: the user may add a measurement plan as an extra requirement.
 */

/**
 * Words for a quality only people can judge once it exists (rhythmisch, spürbar, intuitiv …): a number in the same
 * sentence ("Bei 25 ms Netzwerklatenz muss rhythmisch stabiles Zusammenspiel möglich sein") is a condition, not proof.
 */
const EXPERIENCE =
  /\b(?:rhythmisch\w*|spürbar\w*|intuitiv\w*|benutzerfreundlich\w*|nutzerfreundlich\w*|bedienerfreundlich\w*|angenehm\w*|zufrieden\w*|intuitive\w*|user-friendly|easy to use|pleasant\w*|satisf\w*|noticeabl\w*)\b/i;

/** Words for a quality that a threshold makes checkable: stable, smooth, fast, reliable … (German and English). */
const QUALITY =
  /\b(?:stabil\w*|flüssig\w*|reibungslos\w*|zuverlässig\w*|schnell\w*|latenzarm\w*|performant\w*|ruckelfrei\w*|verzögerungsfrei\w*|störungsfrei\w*|stable|stably|smooth\w*|seamless\w*|reliabl\w*|fast|faster|quick\w*|responsive\w*|low-latency|lag-free|glitch-free)\b/i;

/** A number with a unit the quality can be measured in turns it into a checkable limit. */
const THRESHOLD = /\d+(?:[.,]\d+)?\s?(?:ms\b|millisekunden|milliseconds?|s\b|sek\w*|seconds?|%|fps\b|hz\b|db\b)/i;

/**
 * The statement itself asks for a before/after measurement – checkable as a plan. "wird später getestet" alone names
 * neither method nor target and does not count (external review 31.10.26).
 */
const BEFORE_AFTER = /\bvorher\b.{0,60}\bnachher\b|\bbefore and after\b/i;

export function measurableOnlyAfterImplementation(text: string): boolean {
  if (BEFORE_AFTER.test(text)) return false;
  return EXPERIENCE.test(text) || (QUALITY.test(text) && !THRESHOLD.test(text));
}

/**
 * An additional requirement the user can add – never a replacement for the original one (external review 30.10.26).
 * The user fills in method and target value.
 */
export function measurementPlanSuggestion(text: string): string {
  const quoted = text.trim().replace(/[.!?]+$/, "");
  return `Each proposal names how "${quoted}" is measured before and after the change (method and target value).`;
}
