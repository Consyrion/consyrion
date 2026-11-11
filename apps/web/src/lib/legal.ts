/**
 * Operator of the hosted service app.consyrium.com (owner decision 05.11.26: offered by DEVREMOTE, not under a
 * private name). Values in [brackets] are placeholders: while any remains, every legal page shows a draft notice.
 * Self-hosted installations replace these values with their own operator data.
 */
export const OPERATOR = {
  brand: "CONSYRIUM AI",
  company: "DEVREMOTE",
  street: "Industriestrasse 22",
  city: "8404 Winterthur",
  country: "Schweiz",
  email: "support@consyrium.com",
} as const;

export const LEGAL_UPDATED = "5. November 2026";

export function hasPlaceholders(): boolean {
  return Object.values(OPERATOR).some((v) => v.includes("["));
}
