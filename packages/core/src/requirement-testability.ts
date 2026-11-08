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

/**
 * Owner decision 08.11.26 (#249 part 2, variant A, benchmark case pos-latency-limit "95 % of page loads within 300 ms"):
 * a performance limit in milliseconds or seconds – latency, response or load time – is proven only by measuring the
 * running implementation, however confident the evaluators' estimates are. Cost and availability limits stay estimates
 * (requirement-measure.ts); hours, days, weeks and months are not performance limits.
 */
const PERFORMANCE_LIMIT = /\d+(?:[.,]\d+)?\s?(?:ms\b|millisekunden\b|milliseconds?\b|s\b|sek\.?(?=\s|$)|sekunden\b|seconds?\b|secs?\b)/i;

export function performanceLimit(text: string): boolean {
  return PERFORMANCE_LIMIT.test(text);
}

export function measurableOnlyAfterImplementation(text: string): boolean {
  if (BEFORE_AFTER.test(text)) return false;
  return EXPERIENCE.test(text) || (QUALITY.test(text) && !THRESHOLD.test(text)) || performanceLimit(text);
}

/**
 * An additional requirement the user can add – never a replacement for the original one (external review 30.10.26).
 * The user fills in method and target value.
 */
export function measurementPlanSuggestion(text: string): string {
  const quoted = text.trim().replace(/[.!?]+$/, "");
  return `Each proposal names how "${quoted}" is measured before and after the change (method and target value).`;
}

/**
 * Night test R4 (08.11.26, ChatGPT P1): a requirement that only running the implementation can prove – automated tests
 * pass, a CI workflow is green, a test demonstrates a property. Nobody can confirm it before the code exists, so it
 * blocked every proposal. It stays a hard requirement, marked as a build check: the council checks that a proposal
 * names a concrete verification plan, the verdict says "verified after implementation" (never PASS), and the build
 * is only successful when the real checks are green.
 */
const BUILD_CHECK =
  /\b(?:automatisierte\s+tests?|automated\s+tests?|unit[-\s]?tests?|tests?\s+(?:müssen|muss|must|have to|need to)|(?:müssen|muss|must)\b.{0,80}\btests?\b|node\s+--test|npm\s+test|pytest|github[-\s]actions|ci[-\s](?:pipeline|workflow|lauf|run|checks?)|\.github\/workflows|workflows?\/[\w.-]+\.ya?ml|pipeline\s+(?:muss|must)|(?:test|ci)\s+(?:grün|green))/i;

export function needsBuildVerification(text: string): boolean {
  return BUILD_CHECK.test(text);
}

/**
 * #245: when a requirement can be checked – shown for every requirement on the confirmation screen. `before`: an
 * evaluator can judge it from the proposal (licence, stack, region, a stated limit); `after_implementation`: only a
 * measurement of the running solution can confirm it (a measurement plan can be added as an extra requirement);
 * `build`: only the implementation's tests/CI prove it. Display only – the requirement is never changed.
 */
export type RequirementCheckability = "before" | "after_implementation" | "build";

export function requirementCheckability(text: string): RequirementCheckability {
  if (needsBuildVerification(text)) return "build";
  if (measurableOnlyAfterImplementation(text)) return "after_implementation";
  return "before";
}

/**
 * #249 part 2: gate version from which a requirement only a measurement of the running implementation can prove is
 * checked as a measurement plan (gate 1, architecture) and never counts as met by that plan. Older runs keep their rules.
 */
export const MEASUREMENT_CHECK_GATE_VERSION = 3;

/**
 * How the council checks a confirmed requirement in a run of `gateVersion`: "build" (tests/CI prove it), "measurement"
 * (only measuring the running implementation proves it; gate version 3+) or null (judged from the proposal). Lists
 * confirmed before part 2 carry no "measurement" mark, so it is derived from the wording – deterministic, and the
 * requirement text itself is never changed.
 */
export function requirementVerification(
  item: { text: string; verification?: "build" | "measurement" | null },
  gateVersion: number,
): "build" | "measurement" | null {
  if (item.verification === "build") return "build";
  if (gateVersion < MEASUREMENT_CHECK_GATE_VERSION) return null;
  if (item.verification === "measurement") return "measurement";
  return !needsBuildVerification(item.text) && measurableOnlyAfterImplementation(item.text) ? "measurement" : null;
}
