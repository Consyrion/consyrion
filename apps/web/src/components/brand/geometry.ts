/**
 * Geometry of the original Consyrion mark (issue #67): an open council ring shaped like a "C" with seven
 * nodes – one per canonical phase – around a central verdict node, and an execution line leaving the
 * ring through its opening. Shared by the static mark, the Electric Logo, the favicon and the SVG assets.
 */
export const MARK_VIEWBOX = "0 0 64 64";

const CENTER = 32;
const RADIUS = 22;
/** Opening of the ring on the right side, in degrees from the positive x axis. */
const START_DEG = 40;
const END_DEG = 320;

const round = (value: number) => Math.round(value * 100) / 100;

function pointAt(deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: round(CENTER + RADIUS * Math.cos(rad)), y: round(CENTER - RADIUS * Math.sin(rad)) };
}

const start = pointAt(START_DEG);
const end = pointAt(END_DEG);

/** The council ring, drawn counter-clockwise through the left side. */
export const RING_PATH = `M${start.x} ${start.y} A${RADIUS} ${RADIUS} 0 1 0 ${end.x} ${end.y}`;

/** Approximate ring length, used for dash animations along the outline. */
export const RING_LENGTH = round((2 * Math.PI * RADIUS * (END_DEG - START_DEG)) / 360);

/** Seven phase nodes, evenly spread along the ring (Independent Thinking … Execution Council). */
export const PHASE_NODES = Array.from({ length: 7 }, (_, index) => pointAt(START_DEG + ((END_DEG - START_DEG) * index) / 6));

/** Verdict node and the execution line that leaves the council through the opening. */
export const VERDICT_NODE = { x: CENTER, y: CENTER, r: 4.6 };
export const EXECUTION_PATH = `M${CENTER + 7} ${CENTER} H${CENTER + 24}`;
export const EXECUTION_NODE = { x: CENTER + 26, y: CENTER, r: 2.6 };
