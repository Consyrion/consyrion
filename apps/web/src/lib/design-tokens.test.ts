import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Reads the hex tokens of one CSS block (dark = first :root block, light = :root[data-theme="light"]). */
function tokens(selector: string) {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Text roles that must reach WCAG AA (4.5:1) on every opaque surface they are used on.
const TEXT = ["text", "muted", "primary", "success", "warning", "danger", "accent-text"];
const SURFACES = ["bg", "bg-2", "surface", "surface-2"];

describe.each([
  ["dark", ":root {"],
  ["light", ':root[data-theme="light"]'],
])("%s theme tokens", (_name, selector) => {
  const t = tokens(selector);

  it.each(TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("%s on %s meets WCAG AA", (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("primary buttons keep readable text", () => {
    expect(contrast(t["primary-text"]!, t.primary!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("motion policy", () => {
  it("disables all animations for users who prefer reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\*\s*{[^}]*animation: none !important/);
  });
});
