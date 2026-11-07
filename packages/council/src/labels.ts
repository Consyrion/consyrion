/**
 * Neutral proposal labels (QA live test 07.11.26). The labels are normally letters (A, B, C, …). When the brief
 * itself names its options with letters – "A) US cloud, B) EU GPU, C) hybrid" or "Option A" – a reader saw
 * "Proposal A" next to option A while that proposal actually recommended option C. Such briefs get numbered
 * proposals (1, 2, 3, …) instead, so the two can never be confused.
 */
const LETTERS = "ABCDEFGHIJKL".split("");
const NUMBERS = Array.from({ length: 12 }, (_, i) => String(i + 1));

/** Letters used as option names: "A)" at a line or word start, or "Option/Variante/Alternative A". Needs two different letters. */
export function briefNamesLetterOptions(text: string): boolean {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])([A-F])\)/gm)) found.add(m[1]!);
  for (const m of text.matchAll(
    /\b(?:option|options|variante|varianten|variant|alternative|alternativen|möglichkeit|choice|opción|opcion|solution|lösung)\s+([A-F])\b/gi,
  )) {
    found.add(m[1]!.toUpperCase());
  }
  return found.size >= 2;
}

/** The labels for a council on this brief, in reveal order. */
export function proposalLabels(briefText: string): string[] {
  return briefNamesLetterOptions(briefText) ? NUMBERS : LETTERS;
}

/** The label after the given ones (for a hybrid), in the same style as the existing labels. */
export function nextProposalLabel(existing: string[]): string {
  const numeric = existing.some((l) => /^\d+$/.test(l));
  const alphabet = numeric ? NUMBERS : LETTERS;
  return alphabet[existing.length] ?? (numeric ? String(existing.length + 1) : `H${existing.length}`);
}
