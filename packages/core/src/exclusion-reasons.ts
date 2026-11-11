/**
 * Default reasons the intake suggests for statements it does not take over (the user may override them). They are
 * stored as written; the interface shows a known one in its own language (EXCLUSION_REASON_KEYS → messages
 * requirements.reasons.*) – night test 08.11.26: the English text appeared in the German intake.
 */
/** Statements that look like instructions to the models. */
export const INJECTION_EXCLUSION_REASON = "Reads like an instruction to the AI models, not a product requirement";
export const META_RULE_EXCLUSION_REASON = "Says when a requirement counts as met instead of describing the product – the council judges proposals on substance";
/** Sentences of the idea or goal without binding wording when the brief has its own requirements. */
export const CONTEXT_EXCLUSION_REASON = "From the idea or goal – context, not a hard requirement. Keep it if it is one.";
/** R2-04: an idea or goal sentence that tells the council what to do in this run. */
export const INSTRUCTION_EXCLUSION_REASON = "A work instruction to the council for this run, not a product requirement. Keep it if it is one.";
/** R2-04: an idea or goal sentence that repeats a requirements-field item (same numbers, same words). */
export const DUPLICATE_EXCLUSION_REASON = "Repeats a requirement from the requirements field, so it is listed once. Keep it if it says more.";
/** ask_consyrium / Telegram /frage: a sentence of the question or context, not one of the user's requirement lines. */
export const CLIENT_CONTEXT_EXCLUSION_REASON = "Context of the question, not a requirement the user listed";
/** #245: a document sentence without binding wording of its own. */
export const DOCUMENT_EXCLUSION_REASON =
  "From a document, without binding wording (must, only, at most, a limit …) – a description, table row or measured value. Keep it if it is a requirement.";

export const EXCLUSION_REASON_KEYS: Readonly<Record<string, "injection" | "metaRule" | "context" | "document" | "instruction" | "duplicate">> = {
  [INJECTION_EXCLUSION_REASON]: "injection",
  [META_RULE_EXCLUSION_REASON]: "metaRule",
  [CONTEXT_EXCLUSION_REASON]: "context",
  [DOCUMENT_EXCLUSION_REASON]: "document",
  [INSTRUCTION_EXCLUSION_REASON]: "instruction",
  [DUPLICATE_EXCLUSION_REASON]: "duplicate",
};
