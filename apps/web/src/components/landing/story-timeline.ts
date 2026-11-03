/** Scroll-story timing (#85): a chapter holds its scene first, then blends into the next one. */

/** Share of a chapter during which its scene stands still while the text is read. */
export const HOLD = 0.45;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface Blend {
  from: number;
  to: number;
  /** 0 = scene of `from`, 1 = scene of `to`. */
  t: number;
}

/** Progress `chapter + fraction` (0 … last) → which two scenes to mix and how much. */
export function blendAt(progress: number, last: number): Blend {
  const p = clamp(progress, 0, last);
  const from = Math.min(Math.floor(p), last);
  const to = Math.min(from + 1, last);
  const fraction = p - from;
  return { from, to, t: from === to ? 0 : ease(clamp((fraction - HOLD) / (1 - HOLD))) };
}

/** Keyframes per chapter; `undefined` repeats the previous chapter's value (and is "hidden" before the first). */
export function fillForward<T>(keys: Array<T | undefined>, length: number, hidden: T): T[] {
  const out: T[] = [];
  let last = hidden;
  for (let i = 0; i < length; i++) {
    const key = keys[i];
    if (key !== undefined) last = key;
    out.push(last);
  }
  return out;
}

export function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Progress from chapter rectangles: the chapter under the middle of the viewport plus how far it has scrolled. */
export function progressFromRects(rects: Array<{ top: number; height: number }>, viewportHeight: number) {
  const line = viewportHeight / 2;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (line >= r.top && line < r.top + r.height) return i + (line - r.top) / r.height;
  }
  if (rects.length === 0 || line < rects[0]!.top) return 0;
  return rects.length - 1;
}
