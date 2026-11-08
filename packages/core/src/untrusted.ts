/**
 * Tags the prompts use to mark untrusted data (council: brief, document, proposal, critique, objection, question,
 * response, confirmed_requirements, role_profile; Execution Council: decision, file, task, output).
 */
export const UNTRUSTED_WRAPPER_TAGS = [
  "brief",
  "document",
  "proposal",
  "critique",
  "objection",
  "question",
  "response",
  "confirmed_requirements",
  // #270: a workspace's role profile – a perspective written by users, never instructions.
  "role_profile",
  "decision",
  "file",
  "task",
  "output",
] as const;

const WRAPPER_TAG = new RegExp(`<(/?)(\\s*)(${UNTRUSTED_WRAPPER_TAGS.join("|")})(?=[\\s>/]|$)`, "gi");

/**
 * Neutralises opening and closing wrapper tags inside untrusted text (#406). Without it a document containing
 * `</document></brief>` followed by instructions would close the "untrusted DATA" frame and speak as the prompt.
 * Only the wrapper tag names are touched – other markup (HTML, JSX, XML) stays as it is – and the replacement
 * (`‹/document`) stays readable, so the models still see what the text said.
 */
export function neutralizeWrapperTags(text: string): string {
  return text.replace(WRAPPER_TAG, "‹$1$2$3");
}
