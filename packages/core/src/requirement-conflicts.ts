/**
 * Night test R2-04 (08.11.26): "every copy deleted after seven days at the latest" next to "the same logs readable for at
 * least 30 days" was only found by the council – after a paid run. The intake now points out such pairs before the
 * confirmation. Deterministic and deliberately narrow: a deletion with an upper time bound against a retention with a
 * larger lower bound. It warns, it never blocks: the user may know a reason the wording does not show.
 */

export interface RequirementConflict {
  /** Indexes into the list that was checked (0-based). */
  first: number;
  second: number;
  /** Days of the deletion bound and of the retention bound. */
  deleteWithinDays: number;
  retainDays: number;
}

const WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einem: 1,
  einen: 1,
  one: 1,
  zwei: 2,
  two: 2,
  drei: 3,
  three: 3,
  vier: 4,
  four: 4,
  fünf: 5,
  five: 5,
  sechs: 6,
  six: 6,
  sieben: 7,
  seven: 7,
  acht: 8,
  eight: 8,
  neun: 9,
  nine: 9,
  zehn: 10,
  ten: 10,
  elf: 11,
  eleven: 11,
  zwölf: 12,
  twelve: 12,
  vierzehn: 14,
  fourteen: 14,
  dreißig: 30,
  thirty: 30,
  neunzig: 90,
  ninety: 90,
};
const NUM = String.raw`(\d+|${Object.keys(WORDS).join("|")})`;
const UNIT = String.raw`(kalendertag\w*|werktag\w*|tag\w*|days?|calendar days?|woche\w*|weeks?|monat\w*|months?|jahr\w*|years?)`;
const DAYS_PER: Array<[RegExp, number]> = [
  [/^(?:woche|week)/i, 7],
  [/^(?:monat|month)/i, 30],
  [/^(?:jahr|year)/i, 365],
];

function days(raw: string, unit: string): number {
  const n = /^\d+$/.test(raw) ? Number(raw) : (WORDS[raw.toLowerCase()] ?? NaN);
  const factor = DAYS_PER.find(([re]) => re.test(unit))?.[1] ?? 1;
  return n * factor;
}

const DELETE = /\b(?:gelöscht|löschen|löschung|lösche\w*|entfernt|vernichtet|purged?|deleted?|deletion|erased?|destroyed?)\b/i;
const RETAIN =
  /\b(?:aufbewahr\w*|verfügbar|wiederherstellbar|auslesbar|lesbar|gespeichert bleiben|erhalten bleiben|retain\w*|retention|kept|keep|available|recoverable|restorable|readable)\b/i;
const UPPER = new RegExp(
  String.raw`(?:spätestens|höchstens|maximal|innerhalb\s+(?:von\s+)?|binnen|nach|at the latest|at most|within|after|no later than)\s*(?:von\s+)?${NUM}\s*${UNIT}`,
  "i",
);
const UPPER_AFTER = new RegExp(String.raw`${NUM}\s*${UNIT}[^.;]{0,40}?\b(?:spätestens|at the latest)\b`, "i");
const LOWER = new RegExp(String.raw`(?:mindestens|wenigstens|at least|minimum of|for at least|no less than)\s*${NUM}\s*${UNIT}`, "i");

function deletionBound(text: string): number | null {
  if (!DELETE.test(text)) return null;
  const m = UPPER.exec(text) ?? UPPER_AFTER.exec(text);
  return m ? days(m[1]!, m[2]!) : null;
}

function retentionBound(text: string): number | null {
  if (!RETAIN.test(text)) return null;
  const m = LOWER.exec(text);
  return m ? days(m[1]!, m[2]!) : null;
}

export function findRequirementConflicts(texts: readonly string[]): RequirementConflict[] {
  const conflicts: RequirementConflict[] = [];
  texts.forEach((a, i) => {
    const del = deletionBound(a);
    if (del === null || Number.isNaN(del)) return;
    texts.forEach((b, j) => {
      if (i === j) return;
      const keep = retentionBound(b);
      if (keep === null || Number.isNaN(keep) || keep <= del) return;
      conflicts.push({ first: Math.min(i, j), second: Math.max(i, j), deleteWithinDays: del, retainDays: keep });
    });
  });
  return conflicts;
}
