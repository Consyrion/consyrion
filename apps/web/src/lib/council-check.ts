/**
 * Cross-check labels of the council chat (#241 stage 2) – shared by the server route and the panel (no server code).
 */

export type CheckVerdict = "confirmed" | "contradicted" | "unverifiable";
export const CHECK_VERDICTS: readonly CheckVerdict[] = ["confirmed", "contradicted", "unverifiable"];

/**
 * Topics that stay "not verified" however many models agree (#241 guard rail). Matched against the QUESTION only: answers
 * often use words like "Sicherheit" (also "certainty") or "rechtfertigen" without being about law or security (live test
 * 08.11.26). Word stems are chosen so that common technical words do not match ("health check", "symptom", "Dose").
 */
export const UNVERIFIABLE_TOPICS =
  /\b(medic|medizin|medikament|diagnos|dosis|dosage|arzt|doctor|krank|disease|therap|healthcare|gesundheit|legal|rechtlich|rechtslage|rechtsber|rechtsanw|gesetz|law\b|laws\b|anwalt|lawyer|vertrag|haftung|liabil|security|sicherheitslück|it-sicherheit|datensicherheit|vulnerab|schwachstelle|passw|datenschutz|privacy|gdpr|dsgvo)/i;

/** Medicine, law, security, data protection: never "verified", however many models agree. Pass the user's question. */
export function isSensitiveTopic(question: string): boolean {
  return UNVERIFIABLE_TOPICS.test(question);
}

/**
 * Model ids as stored ("openai/gpt-5.4-mini-2026-03-17" – the provider returns the dated version) against the id the
 * user picked ("gpt-5.4-mini"): provider prefix, a trailing date and "-latest" are ignored (live test 08.11.26 – without
 * this a model checked its own answer and a second check of the same model was offered).
 */
export function sameModelId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (x: string) =>
    x
      .split("/")
      .pop()!
      .toLowerCase()
      .replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "")
      .replace(/-latest$/, "");
  return norm(a) === norm(b);
}

/**
 * Overall label of one answer from its checks. "confirmed" only when every check confirms and the topic is not
 * sensitive; one contradiction makes it "contradicted" (it stays visible next to the answer); otherwise "unverified".
 */
export function checkSummary(verdicts: CheckVerdict[], sensitive: boolean): "confirmed" | "contradicted" | "unverified" | null {
  if (!verdicts.length) return null;
  if (verdicts.includes("contradicted")) return "contradicted";
  if (!sensitive && verdicts.every((v) => v === "confirmed")) return "confirmed";
  return "unverified";
}
