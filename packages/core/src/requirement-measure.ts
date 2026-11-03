/**
 * Measurable requirements (owner decision 30.10.26): a time limit, a monthly cost limit or a minimum availability is
 * not answered with "met / not met" – every evaluator estimates a range in the requirement's unit, and the gate
 * compares the ranges with the limit. Detected deterministically from the confirmed wording, never by a model.
 */

export type MeasureUnit = "months" | "weeks" | "EUR/month" | "%";

export interface RequirementMeasure {
  /** max: the estimate must stay at or below the limit (time, cost); min: at or above it (availability). */
  direction: "max" | "min";
  value: number;
  unit: MeasureUnit;
  /**
   * #226: "unter 150 €", "less than 4 months", "über 99,9 %" exclude the limit itself; "höchstens", "at most",
   * "nicht überschreiten", "mindestens" include it. Absent on lists confirmed before 31.10.26 (inclusive, as then).
   */
  strict?: true;
}

/** Spelled-out numbers up to twelve, as in "innerhalb von zwölf Wochen" (German and English). */
const WORDS: Record<string, number> = {
  ein: 1,
  eins: 1,
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
};
// #226: "1,000 EUR" (English thousands) was read as 1 EUR. A comma followed by exactly three digits groups thousands,
// as in "1,000" or "12,500.50"; "1,5" and "99,95" stay decimals.
const GROUPED = String.raw`\d{1,3}(?:[.' ]\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])`;
const NUMBER = String.raw`(${GROUPED}|\d+(?:[.,]\d+)?)`;
const DURATION_NUMBER = String.raw`(${GROUPED}|\d+(?:[.,]\d+)?|${Object.keys(WORDS).join("|")})`;

function parseNumber(raw: string): number {
  const word = WORDS[raw.toLowerCase()];
  if (word !== undefined) return word;
  // "1.000" / "1'000" / "1 000" / "1,000" are thousands; "99,5" and "4.5" are decimals.
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ""));
  const grouped = /^\d{1,3}(?:[.' ]\d{3})+(?:,\d+)?$/.test(raw);
  const plain = grouped ? raw.replace(/[.' ]/g, "").replace(",", ".") : raw.replace(",", ".");
  return Number(plain);
}

const DURATION = new RegExp(
  String.raw`(?:innerhalb(?:\s+von)?|binnen|spätestens(?:\s+(?:in|nach))?|in(?:\s+weniger\s+als)?|weniger\s+als|in\s+less\s+than|less\s+than|within|max(?:imal|\.)?|höchstens|at most|no more than|bis zu|not later than)\s+${DURATION_NUMBER}\s*(Monat(?:e|en)?|months?|Wochen?|weeks?)\b`,
  "gi",
);
const COST = new RegExp(String.raw`(?:(?:EUR|€|Euro)\s*${NUMBER}|${NUMBER}\s*(?:EUR|€|Euro|euros?))\s*(?:pro|per|/|im|je|a|each)\s*(?:Monat|month|mo)\b`, "gi");
/** "Die monatlichen Betriebskosten dürfen 150 € nicht überschreiten": the period is named before the amount. */
const MONTHLY = /\b(monatlich\w*|monthly)\b/i;
const AMOUNT = new RegExp(
  String.raw`(?:(?:EUR|€|Euro)\s*${NUMBER}|${NUMBER}\s*(?:EUR|€|Euro|euros?))(?!\s*(?:pro|per|/|im|je|a|each)\s*(?:Monat|month|mo)\b)`,
  "gi",
);
const COST_LIMIT =
  /(nicht\s+(?:über|überschreiten|mehr\s+als)|überschreiten|max(?:imal|\.)?|höchstens|bis\s+zu|unter|weniger\s+als|less\s+than|at\s+most|not\s+exceed|no\s+more\s+than|maximum|below|under|≤|<=?|budget)/i;
const PERCENT = new RegExp(String.raw`${NUMBER}\s*%`, "g");
const PERCENT_MIN = /(mindestens|min(?:imum|\.)?|wenigstens|at\s+least|≥|>=|verfügbarkeit|availability|uptime)/i;

/**
 * A limit that excludes its value (#226): the strict word stands directly before the number ("unter 150 €",
 * "in weniger als 4 Monaten", "über 99,9 %", "< 150"). Not after a negation – "nicht über 150 €" and "no more than"
 * are inclusive – and not elsewhere in the sentence ("innerhalb von 4 Monaten unter Einhaltung …").
 */
const NOT_NEGATED = String.raw`(?<!(?:nicht|not|no|keine?)\s+)(?<![\p{L}])`;
const BEFORE_NUMBER = String.raw`\s*(?:(?:EUR|€|Euro)\s*)?\d`;
const STRICT_MAX = new RegExp(String.raw`(?:${NOT_NEGATED}(?:unter|weniger als|less than|fewer than|below|under)|<(?!=))${BEFORE_NUMBER}`, "iu");
const STRICT_MIN = new RegExp(String.raw`(?:${NOT_NEGATED}(?:über|mehr als|more than|greater than|higher than|above)|>(?!=))${BEFORE_NUMBER}`, "iu");

function measuresIn(text: string): RequirementMeasure[] {
  const found: RequirementMeasure[] = [];
  for (const m of text.matchAll(DURATION)) {
    const value = parseNumber(m[1]!);
    if (value > 0) found.push({ direction: "max", value, unit: /^(Woche|week)/i.test(m[2]!) ? "weeks" : "months" });
  }
  if (COST_LIMIT.test(text)) {
    for (const m of text.matchAll(COST)) {
      const value = parseNumber((m[1] ?? m[2])!);
      if (value > 0) found.push({ direction: "max", value, unit: "EUR/month" });
    }
    if (MONTHLY.test(text))
      for (const m of text.matchAll(AMOUNT)) {
        const value = parseNumber((m[1] ?? m[2])!);
        if (value > 0) found.push({ direction: "max", value, unit: "EUR/month" });
      }
  }
  if (PERCENT_MIN.test(text))
    for (const m of text.matchAll(PERCENT)) {
      const value = parseNumber(m[1]!);
      if (value > 0 && value <= 100) found.push({ direction: "min", value, unit: "%" });
    }
  return found;
}

/** The single measurable limit of a requirement, or null when there is none or more than one (compound wording). */
export function detectMeasure(text: string): RequirementMeasure | null {
  const found = measuresIn(text);
  if (found.length !== 1) return null;
  const measure = found[0]!;
  return (measure.direction === "max" ? STRICT_MAX : STRICT_MIN).test(text) ? { ...measure, strict: true } : measure;
}

/** How many limits a sentence names: more than one means it is not checked as a number (#226: split it). */
export function countLimits(text: string): number {
  return measuresIn(text).length;
}

const UNIT_TEXT: Record<MeasureUnit, string> = { months: "months", weeks: "weeks", "EUR/month": "EUR per month", "%": "%" };

/** "at most 4 months", "at least 99.5 %", "below 150 EUR per month". */
export function describeMeasure(measure: RequirementMeasure): string {
  const relation = measure.direction === "max" ? (measure.strict ? "below" : "at most") : measure.strict ? "above" : "at least";
  return `${relation} ${measure.value}${measure.unit === "%" ? " %" : ` ${UNIT_TEXT[measure.unit]}`}`;
}

export function measureUnitText(unit: MeasureUnit): string {
  return UNIT_TEXT[unit];
}
