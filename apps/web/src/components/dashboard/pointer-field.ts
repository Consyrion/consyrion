/** Pointer position in the viewBox coordinates of an SVG drawn at `width` × `height` units. */
export function svgPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement, width: number, height: number) {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
}

/**
 * Pull of the pointer on an element at (x, y): 0 outside `radius`, rising to 1 on top of it, plus the unit
 * direction towards the pointer. Used to let nodes lean towards the mouse.
 */
export function pointerPull(pointer: { x: number; y: number } | null, x: number, y: number, radius: number) {
  if (!pointer) return { strength: 0, ux: 0, uy: 0 };
  const dx = pointer.x - x;
  const dy = pointer.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return { strength: 0, ux: 0, uy: 0 };
  const strength = 1 - distance / radius;
  return { strength: strength * strength * (3 - 2 * strength), ux: distance ? dx / distance : 0, uy: distance ? dy / distance : 0 };
}

/** Moves `current` a fraction of the way to `target` each frame, so reactions ease in and out. */
export function ease(current: number, target: number, rate = 0.14) {
  return current + (target - current) * rate;
}
