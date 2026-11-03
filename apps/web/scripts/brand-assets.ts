/**
 * Writes the static CONSYRION AI brand assets (favicon, mark, logo with wordmark) from the shared geometry,
 * so the files never drift from the React components. Run: node scripts/brand-assets.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXECUTION_NODE, EXECUTION_PATH, MARK_VIEWBOX, PHASE_NODES, RING_PATH, VERDICT_NODE } from "../src/components/brand/geometry.ts";

const CYAN = "#00D8FF";
const EMERALD = "#24E0B5";
const VIOLET = "#8B5CF6";
const INK = "#060B15";

export function markShapes(stroke: string, nodeFill: string) {
  return [
    `<path d="${RING_PATH}" stroke="${stroke}" stroke-width="4.2" stroke-linecap="round"/>`,
    `<path d="${EXECUTION_PATH}" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`,
    ...PHASE_NODES.map((n) => `<circle cx="${n.x}" cy="${n.y}" r="3.1" fill="${nodeFill}" stroke="${stroke}" stroke-width="2.2"/>`),
    `<circle cx="${VERDICT_NODE.x}" cy="${VERDICT_NODE.y}" r="${VERDICT_NODE.r}" fill="${stroke}"/>`,
    `<circle cx="${EXECUTION_NODE.x}" cy="${EXECUTION_NODE.y}" r="${EXECUTION_NODE.r}" fill="${stroke}"/>`,
  ].join("");
}

const gradient = `<linearGradient id="g" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${CYAN}"/><stop offset="0.55" stop-color="${EMERALD}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient>`;

export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="none" role="img" aria-label="CONSYRION AI"><title>CONSYRION AI</title><defs>${gradient}</defs>${markShapes("url(#g)", INK)}</svg>\n`;

/** Favicon: the mark on an ink tile so it stays visible on light and dark browser chrome. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="none"><defs>${gradient}</defs><rect width="64" height="64" rx="14" fill="${INK}"/>${markShapes("url(#g)", INK)}</svg>\n`;

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 64" fill="none" role="img" aria-label="CONSYRION AI"><title>CONSYRION AI</title><defs>${gradient}</defs>${markShapes("url(#g)", INK)}<text x="78" y="42" fill="#E8EEFC" font-family="Avenir Next, Segoe UI, Inter, sans-serif" font-size="26" font-weight="600" letter-spacing="7">CONSYRION AI</text></svg>\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL("../", import.meta.url);
  writeFileSync(new URL("src/app/icon.svg", root), ICON_SVG);
  writeFileSync(new URL("public/brand/consyrion-mark.svg", root), MARK_SVG);
  writeFileSync(new URL("public/brand/consyrion-logo.svg", root), LOGO_SVG);
  console.log("brand assets written");
}
