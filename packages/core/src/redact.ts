/**
 * Strings that look like provider API keys, GitHub tokens, Stripe webhook secrets or Consyrion API tokens (full cns_,
 * integration cni_, read-only cnr_). Shared by the web logger and the packages that log directly (#403), so a secret in
 * an error message never reaches a log line.
 */
export const SECRET_VALUE_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|cn[sir]_[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|whsec_[A-Za-z0-9]+)\b/g;

/** Replaces anything that looks like a secret with `[redacted]`. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_VALUE_PATTERN, "[redacted]");
}
