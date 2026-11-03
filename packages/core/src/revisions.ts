/**
 * How far a proposal moved between its first and its current revision (#150). In a real run a model replaced its
 * whole architecture in the Consensus Round (Go + Redis on one server → Django + PostgreSQL constraint on two), and
 * the verdict still listed the objections against the first version as remaining risks of the recommendation.
 * Lexical comparison only: it flags what clearly no longer applies, it does not re-review anything.
 */

const STOP = new Set(
  (
    "the and for with that this from are was were will would should could can not but its into than then them they their there these those about over under such only also more most very much each other which when what where who why how our your you use using used does done have has had been being per via any all may might must one two like just own " +
    "und oder der die das den dem des ein eine einer einem einen eines für mit von bei aus auf nach über unter durch gegen ohne ist sind war wird werden wurde kann können muss müssen soll sollte nicht auch als wie wenn dass damit daher dann noch nur sehr mehr alle alles jede jeder jedes diese dieser dieses sich wir ihr sie uns zum zur vom beim im ins am bis statt"
  ).split(" "),
);

/** All text of a stored proposal content (title, summary, architecture, lists …) as one string. */
export function contentText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string" || typeof content === "number") return String(content);
  if (Array.isArray(content)) return content.map(contentText).join(" ");
  if (typeof content === "object")
    return Object.values(content as Record<string, unknown>)
      .map(contentText)
      .join(" ");
  return "";
}

function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-zäöüß0-9][a-zäöüß0-9.+#-]*[a-zäöüß0-9+#]|[a-z0-9]{2}/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w)));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Core of a proposal: what it recommends and how it is built. */
function core(content: unknown) {
  const c = (content ?? {}) as Record<string, unknown>;
  return terms(contentText([c.title, c.summary, c.architecture]));
}

/** Below this overlap of title, summary and architecture the current revision is a different solution. */
const SAME_SOLUTION = 0.3;
/** At least this overlap with another proposal's first version counts as taken over from it. */
const ADOPTED = 0.2;

export interface ArchitectureChange {
  changed: boolean;
  /** Labels of other proposals whose first version the current revision clearly resembles (more than its own first one). */
  adoptedFrom: string[];
}

export function architectureChange(first: unknown, latest: unknown, others: ReadonlyArray<{ label: string; content: unknown }>): ArchitectureChange {
  const now = core(latest);
  const own = jaccard(core(first), now);
  if (own >= SAME_SOLUTION) return { changed: false, adoptedFrom: [] };
  const adoptedFrom = others.filter((o) => jaccard(core(o.content), now) >= Math.max(own + 0.1, ADOPTED)).map((o) => o.label);
  return { changed: true, adoptedFrom };
}

/**
 * An objection against an earlier revision no longer applies when the things it names are gone: of the terms the
 * objection shares with that earlier version (e.g. "redis", "go", "cx22"), most no longer occur in the current one.
 */
export function objectionMoot(claim: string, earlier: unknown, latest: unknown): boolean {
  const before = terms(contentText(earlier));
  const now = terms(contentText(latest));
  const named = [...terms(claim)].filter((w) => before.has(w));
  if (named.length === 0) return false;
  const gone = named.filter((w) => !now.has(w)).length;
  return gone * 10 >= named.length * 6;
}

interface RevisionLike {
  version: number;
  content: unknown;
  createdAt: Date | string;
}

/**
 * Splits objections against a proposal into those that still apply to its current revision and those raised against
 * an earlier revision whose subject the current one no longer contains (#150). The second group is not a remaining
 * risk of the recommendation: it is reported as made moot by the revision, not independently re-reviewed.
 */
export function splitObjections<O extends { claim: string; createdAt: Date | string }>(objections: ReadonlyArray<O>, revisions: ReadonlyArray<RevisionLike>) {
  const ordered = [...revisions].sort((x, y) => x.version - y.version);
  const latest = ordered.at(-1);
  const current: O[] = [];
  const moot: Array<O & { againstVersion: number; currentVersion: number }> = [];
  for (const objection of objections) {
    const raised = new Date(objection.createdAt).getTime();
    // The revision the objection was raised against: the newest one that existed at that time.
    const target = [...ordered].reverse().find((r) => new Date(r.createdAt).getTime() <= raised) ?? ordered[0];
    if (latest && target && target.version < latest.version && objectionMoot(objection.claim, target.content, latest.content)) {
      moot.push({ ...objection, againstVersion: target.version, currentVersion: latest.version });
    } else current.push(objection);
  }
  return { current, moot };
}
