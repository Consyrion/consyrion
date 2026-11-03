"use client";

import { useEffect, useId, useRef } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";
import { EXECUTION_NODE, EXECUTION_PATH, PHASE_NODES, RING_PATH, VERDICT_NODE } from "./geometry";

/** Layout of the lockup in its own coordinate system: the 64×64 mark scaled ×2, then the wordmark. */
const WIDTH = 952;
const HEIGHT = 150;
const MARK_SCALE = 2;
const MARK_X = 8;
const MARK_Y = 11;
const TEXT_X = 168;
const TEXT_BASELINE = 103;
const TEXT_LENGTH = 768;
const FONT_SIZE = 78;

const ARC_INTERVAL_MS = 90;
const MAX_ARCS = 4;

type Point = { x: number; y: number };

/** Midpoint displacement: a jagged lightning polyline between two points. */
function bolt(a: Point, b: Point, roughness: number, depth = 4): Point[] {
  if (depth === 0) return [a, b];
  const mid = { x: (a.x + b.x) / 2 + (Math.random() - 0.5) * roughness, y: (a.y + b.y) / 2 + (Math.random() - 0.5) * roughness };
  return [...bolt(a, mid, roughness / 2, depth - 1).slice(0, -1), ...bolt(mid, b, roughness / 2, depth - 1)];
}

const toPath = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

/** Mark and wordmark as strokes of one width (in lockup units); `body` renders only the dark letter fill. */
function Outline({ width = 0, body = false }: { width?: number; body?: boolean }) {
  const w = width / MARK_SCALE;
  return (
    <>
      {body ? null : (
        <g transform={`translate(${MARK_X} ${MARK_Y}) scale(${MARK_SCALE})`}>
          <path d={RING_PATH} strokeWidth={w} />
          <path d={EXECUTION_PATH} strokeWidth={w} />
          {PHASE_NODES.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={3.1} strokeWidth={w} />
          ))}
          <circle cx={VERDICT_NODE.x} cy={VERDICT_NODE.y} r={VERDICT_NODE.r} strokeWidth={w} />
          <circle cx={EXECUTION_NODE.x} cy={EXECUTION_NODE.y} r={EXECUTION_NODE.r} strokeWidth={w} />
        </g>
      )}
      <text x={TEXT_X} y={TEXT_BASELINE} textLength={TEXT_LENGTH} lengthAdjust="spacingAndGlyphs" fontSize={FONT_SIZE} fontWeight={600} fontFamily="var(--font-display)" strokeWidth={width}>
        CONSYRION AI
      </text>
    </>
  );
}

/**
 * Electric lockup (issue #67): the CONSYRION AI mark and the CONSYRION AI wordmark drawn as a living lightning
 * outline – a glowing halo, a crackling core stroke (animated turbulence) and short arcs that leap off the
 * edges. Original SVG implementation inspired by the React Bits "Electric Logo" idea; no third-party code.
 * Server render, reduced motion and hidden tabs show the static glowing outline without arcs.
 */
export function ElectricLockup({ className = "", label = "CONSYRION AI" }: { className?: string; label?: string }) {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const uid = useId().replace(/:/g, "");
  const arcsRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGPathElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const live = !reduced && visible;

  useEffect(() => {
    const group = arcsRef.current;
    const ring = ringRef.current;
    const text = textRef.current;
    if (!live || !group || !ring || !text) return;
    const ringLength = ring.getTotalLength();
    const box = text.getBBox();
    const paths = Array.from({ length: MAX_ARCS }, () => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      group.appendChild(p);
      return { el: p, until: 0 };
    });

    // A point on an edge plus the outward direction an arc should leap towards.
    const edgePoint = (): { at: Point; out: Point } => {
      if (Math.random() < 0.35) {
        const pt = ring.getPointAtLength(Math.random() * ringLength);
        const at = { x: MARK_X + pt.x * MARK_SCALE, y: MARK_Y + pt.y * MARK_SCALE };
        const cx = MARK_X + 32 * MARK_SCALE;
        const cy = MARK_Y + 32 * MARK_SCALE;
        const len = Math.hypot(at.x - cx, at.y - cy) || 1;
        return { at, out: { x: (at.x - cx) / len, y: (at.y - cy) / len } };
      }
      const top = Math.random() < 0.5;
      return { at: { x: box.x + Math.random() * box.width, y: top ? box.y + box.height * 0.18 : box.y + box.height * 0.86 }, out: { x: (Math.random() - 0.5) * 0.6, y: top ? -1 : 1 } };
    };

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < ARC_INTERVAL_MS) return;
      last = now;
      for (const arc of paths) {
        if (arc.until > now) continue;
        if (Math.random() < 0.55) {
          arc.el.setAttribute("d", "");
          arc.until = now + 60 + Math.random() * 200;
          continue;
        }
        const { at, out } = edgePoint();
        const reach = 12 + Math.random() * 26;
        const end = { x: at.x + out.x * reach + (Math.random() - 0.5) * 18, y: at.y + out.y * reach + (Math.random() - 0.5) * 10 };
        arc.el.setAttribute("d", toPath(bolt(at, end, reach * 0.9)));
        arc.until = now + 70 + Math.random() * 160;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      paths.forEach((p) => p.el.remove());
    };
  }, [live]);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={`h-auto w-full overflow-visible ${className}`} role="img" aria-label={label} data-electric={live ? "on" : "off"}>
      <defs>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2={WIDTH} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="0.5" stopColor="var(--success)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <filter id={`${uid}-halo`} x="-10%" y="-40%" width="120%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id={`${uid}-crackle`} x="-5%" y="-30%" width="110%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.55" numOctaves="2" seed="3" result="noise">
            {live ? <animate attributeName="seed" values="1;5;2;7;3;8;4" dur="0.6s" calcMode="discrete" repeatCount="indefinite" /> : null}
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={live ? 2.4 : 1} xChannelSelector="R" yChannelSelector="G" result="jitter" />
          <feGaussianBlur in="jitter" stdDeviation="0.8" result="soft" />
          <feMerge>
            <feMergeNode in="soft" />
            <feMergeNode in="jitter" />
          </feMerge>
        </filter>
        <filter id={`${uid}-arc`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Dark body so the outline reads as a lit edge, like the reference effect. */}
      <g fill="var(--bg)" stroke="none">
        <Outline body />
      </g>
      {/* Halo */}
      <g fill="none" stroke={`url(#${uid}-g)`} opacity={0.75} filter={`url(#${uid}-halo)`} style={live ? { animation: "consyrion-flicker 2.8s steps(1) infinite" } : undefined}>
        <Outline width={5} />
      </g>
      {/* Crackling core */}
      <g fill="none" stroke="var(--electric-core)" filter={`url(#${uid}-crackle)`}>
        <Outline width={1.6} />
      </g>
      <g fill="none" stroke={`url(#${uid}-g)`} opacity={0.9}>
        <Outline width={0.9} />
      </g>
      {/* Invisible copies used to measure edges for the arcs. */}
      <g fill="none" stroke="none" aria-hidden="true">
        <path ref={ringRef} d={RING_PATH} />
        <text ref={textRef} x={TEXT_X} y={TEXT_BASELINE} textLength={TEXT_LENGTH} lengthAdjust="spacingAndGlyphs" fontSize={FONT_SIZE} fontWeight={600} fontFamily="var(--font-display)">
          CONSYRION AI
        </text>
      </g>
      <g ref={arcsRef} fill="none" stroke="var(--electric-core)" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${uid}-arc)`} />
    </svg>
  );
}
