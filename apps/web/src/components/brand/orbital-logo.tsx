"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";
import { STAGE_COLORS } from "../fx/ribbon-field";
import { MarkShapes } from "./consyrium-logo";
import { RING_PATH } from "./geometry";
import type { Spheres3D, SphereState } from "./orbital-spheres-3d";

interface Planet {
  color: string;
  /** Lighter tint for the marbled bands. */
  tint: string;
  /** Start angle on the orbit in degrees (90 = nearest point, -90 = farthest). */
  angle: number;
  /** Seconds per turn around the sphere's own axis. */
  spin: number;
}

/** Start arrangement of the design concept: violet at the back on top, mint and cyan in front. */
const PLANETS: Planet[] = [
  { color: STAGE_COLORS.violet, tint: "#c4b5fd", angle: -90, spin: 22 },
  { color: STAGE_COLORS.green, tint: "#a7f3d0", angle: 30, spin: 26 },
  { color: STAGE_COLORS.cyan, tint: "#a5f3fc", angle: 150, spin: 19 },
];

const ORBIT_RX = 172;
const ORBIT_RY = 66;
const TILT = (-12 * Math.PI) / 180;
/** Seconds per full orbit: slow and continuous. */
const ORBIT_SECONDS = 48;
const PLANET_R = 36;
const CORE_R = 56;
const FRAME_MS = 1000 / 40;
const VIEW_BOX = { x: -240, y: -165, width: 480, height: 330 };

/** Orbit rotation in degrees after `seconds` – continuous, one full turn per ORBIT_SECONDS. */
export function orbitAngle(seconds: number) {
  return (360 * seconds) / ORBIT_SECONDS;
}

/** Screen position, depth and size of a sphere on the tilted orbit. */
export function orbitState(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  const ex = ORBIT_RX * Math.cos(a);
  const ey = ORBIT_RY * Math.sin(a);
  const depth = Math.sin(a);
  return {
    x: ex * Math.cos(TILT) - ey * Math.sin(TILT),
    y: ex * Math.sin(TILT) + ey * Math.cos(TILT),
    depth,
    scale: 0.8 + (0.28 * (depth + 1)) / 2,
  };
}

/** Half of the orbit ellipse as a path: the far half is drawn behind the core, the near half in front. */
function orbitArc(near: boolean, rx = ORBIT_RX, ry = ORBIT_RY) {
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (near ? 0 : Math.PI) + (i / 48) * Math.PI;
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    pts.push(`${(ex * Math.cos(TILT) - ey * Math.sin(TILT)).toFixed(1)} ${(ex * Math.sin(TILT) + ey * Math.cos(TILT)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/** A wave across two periods (width 4r) so sliding the SVG fallback surface by -2r loops without a seam. */
function wave(r: number, y0: number, amp: number, turns: number, shift: number) {
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = -r + (i * 4 * r) / 40;
    pts.push(`${x.toFixed(1)} ${(y0 + amp * Math.sin(((x + r) / (2 * r)) * 2 * Math.PI * turns + shift)).toFixed(1)}`);
  }
  return pts;
}

function surface(r: number) {
  const bands: string[] = [];
  for (let k = 0; k < 4; k++) {
    const y0 = -r * 0.75 + k * r * 0.48;
    const top = wave(r, y0, r * 0.16, 1 + (k % 2), k * 1.3);
    const bottom = wave(r, y0 + r * 0.16, r * 0.22, 1 + (k % 2), k * 1.3 + 0.8).reverse();
    bands.push(`M${top.join(" L")} L${bottom.join(" L")} Z`);
  }
  const lines: string[] = [];
  for (let k = -4; k <= 4; k++) lines.push(`M${wave(r, (k / 4.6) * r, r * (0.06 + 0.025 * Math.abs(k)), 2, k * 0.9).join(" L")}`);
  return { bands, lines: lines.join(" ") };
}

/**
 * Sign-in brand illustration (#84): the original CONSYRIUM AI mark as the sun in a glowing core, three plastic
 * spheres in cyan, mint and violet on a slow tilted orbit around it – passing behind the core on the far side and
 * in front of it on the near side, larger when near – linked to the core by energy spokes. Purely decorative:
 * aria-hidden, no status meaning, not a running council.
 *
 * Where WebGL is available the spheres are real 3D (three.js, loaded on demand): one canvas behind and one in
 * front of the SVG core give real occlusion, lit from the logo. The SVG spheres are the server render and the
 * fallback. Motion runs on requestAnimationFrame (no React state per frame), pauses when the tab or the element
 * is hidden and via the Pause button, and is a still frame for reduced motion.
 */
export function ConsyriumOrbitalLogo({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const backRef = useRef<SVGGElement>(null);
  const frontRef = useRef<SVGGElement>(null);
  const planetRefs = useRef<Array<SVGGElement | null>>([]);
  const armRefs = useRef<Array<SVGGElement | null>>([]);
  const backCanvas = useRef<HTMLCanvasElement>(null);
  const frontCanvas = useRef<HTMLCanvasElement>(null);
  const layers = useRef<{ back: Spheres3D; front: Spheres3D } | null>(null);
  const [webgl, setWebgl] = useState(false);
  const elapsed = useRef(0);
  const animate = !reduced && visible && !paused;

  const draw = (seconds: number) => {
    const rotation = orbitAngle(seconds);
    const states = PLANETS.map((planet) => orbitState(planet.angle + rotation));
    if (layers.current) {
      const toLayer = (front: boolean): SphereState[] => states.map((s) => ({ ...s, visible: s.depth >= 0 === front }));
      layers.current.back.render(toLayer(false), seconds);
      layers.current.front.render(toLayer(true), seconds);
    }
    states.forEach((s, index) => {
      const el = planetRefs.current[index];
      if (el) {
        el.setAttribute("transform", `translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) scale(${s.scale.toFixed(3)})`);
        const layer = s.depth >= 0 ? frontRef.current : backRef.current;
        if (layer && el.parentNode !== layer) layer.appendChild(el);
      }
      const arm = armRefs.current[index];
      if (arm) {
        const dist = Math.hypot(s.x, s.y);
        const end = Math.max(CORE_R + 6, dist - PLANET_R * s.scale - 2).toFixed(1);
        arm.setAttribute("transform", `rotate(${((Math.atan2(s.y, s.x) * 180) / Math.PI).toFixed(2)})`);
        arm.querySelectorAll("line").forEach((line) => line.setAttribute(line.dataset.reverse ? "x1" : "x2", end));
      }
    });
  };

  useEffect(() => {
    const back = backCanvas.current;
    const front = frontCanvas.current;
    if (!back || !front) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import("./orbital-spheres-3d").then(({ createSpheres3D }) => {
      if (cancelled) return;
      const specs = PLANETS.map((planet) => ({ color: planet.color, tint: planet.tint, radius: PLANET_R, spin: planet.spin }));
      const backLayer = createSpheres3D(back, specs, VIEW_BOX);
      const frontLayer = backLayer ? createSpheres3D(front, specs, VIEW_BOX) : null;
      if (!backLayer || !frontLayer) {
        backLayer?.dispose();
        return;
      }
      layers.current = { back: backLayer, front: frontLayer };
      observer = new ResizeObserver(() => {
        backLayer.resize();
        frontLayer.resize();
        draw(elapsed.current);
      });
      observer.observe(front);
      setWebgl(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      layers.current?.back.dispose();
      layers.current?.front.dispose();
      layers.current = null;
    };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    draw(elapsed.current);
    if (!animate) return;
    let onScreen = true;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
    });
    observer.observe(svg);
    let frame = 0;
    let last = performance.now();
    let lastDraw = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = (now - last) / 1000;
      last = now;
      if (!onScreen) return;
      elapsed.current += Math.max(0, Math.min(delta, 0.1));
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw(elapsed.current);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [animate, webgl]);

  const { bands, lines } = surface(PLANET_R);
  const initial = PLANETS.map((planet) => orbitState(planet.angle));

  const planetNode = (planet: Planet, index: number) => {
    const s = initial[index]!;
    return (
      <g
        key={index}
        ref={(el) => {
          planetRefs.current[index] = el;
        }}
        transform={`translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) scale(${s.scale.toFixed(3)})`}
        data-planet={index}
        opacity={webgl ? 0 : 1}
      >
        <circle r={PLANET_R * 1.3} fill={planet.color} opacity={0.4} filter={`url(#${uid}-glow)`} />
        <circle r={PLANET_R} fill="#070b1d" />
        <circle r={PLANET_R} fill={`url(#${uid}-body-${index})`} />
        <g clipPath={`url(#${uid}-clip)`}>
          <g
            className="planet-surface"
            style={animate && !webgl ? ({ "--travel-x": `${-2 * PLANET_R}px`, animation: `consyrium-spin-surface ${planet.spin}s linear infinite` } as CSSProperties) : undefined}
          >
            {bands.map((d, k) => (
              <path key={k} d={d} fill={k % 2 ? "#020617" : planet.tint} fillOpacity={k % 2 ? 0.28 : 0.3} />
            ))}
            <path d={lines} fill="none" stroke="#ffffff" strokeOpacity={0.4} strokeWidth={0.7} />
          </g>
        </g>
        <circle r={PLANET_R} fill={`url(#${uid}-shade)`} />
        <circle r={PLANET_R} fill="none" stroke={planet.tint} strokeWidth={1.6} />
      </g>
    );
  };

  return (
    <div className={`relative ${className}`}>
      <canvas ref={backCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" data-spheres={webgl ? "3d" : "svg"} />
      <svg
        ref={svgRef}
        viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
        className="relative h-auto w-full overflow-visible"
        aria-hidden="true"
        focusable="false"
        data-orbital={animate ? "on" : "off"}
      >
        <defs>
          <radialGradient id={`${uid}-halo`} cx="0" cy="0" r="210" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={STAGE_COLORS.cyan} stopOpacity="0.2" />
            <stop offset="0.5" stopColor={STAGE_COLORS.violet} stopOpacity="0.07" />
            <stop offset="1" stopColor={STAGE_COLORS.violet} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-core`} cx="0.4" cy="0.35" r="0.75">
            <stop offset="0" stopColor="#13284a" />
            <stop offset="1" stopColor="#050a18" />
          </radialGradient>
          <linearGradient id={`${uid}-rim`} x1="-60" y1="-60" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={STAGE_COLORS.cyan} />
            <stop offset="0.6" stopColor={STAGE_COLORS.blue} />
            <stop offset="1" stopColor={STAGE_COLORS.violet} />
          </linearGradient>
          <linearGradient id={`${uid}-mark`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={STAGE_COLORS.cyan} />
            <stop offset="0.5" stopColor={STAGE_COLORS.blue} />
            <stop offset="1" stopColor={STAGE_COLORS.violet} />
          </linearGradient>
          {/* SVG fallback: fixed light from the upper left. */}
          <radialGradient id={`${uid}-shade`} cx="0.3" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="0.3" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="0.7" stopColor="#020617" stopOpacity="0.25" />
            <stop offset="1" stopColor="#020617" stopOpacity="0.65" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id={`${uid}-clip`}>
            <circle r={PLANET_R - 1} />
          </clipPath>
          {PLANETS.map((planet, index) => (
            <radialGradient key={index} id={`${uid}-body-${index}`} cx="0.45" cy="0.4" r="0.7">
              <stop offset="0" stopColor={planet.tint} stopOpacity="0.55" />
              <stop offset="0.55" stopColor={planet.color} stopOpacity="0.85" />
              <stop offset="1" stopColor={planet.color} />
            </radialGradient>
          ))}
        </defs>

        <circle r="220" fill={`url(#${uid}-halo)`} />
        <g fill="none">
          <path d={orbitArc(false, ORBIT_RX + 30, ORBIT_RY + 14)} stroke="#9fc4ff" strokeOpacity="0.18" strokeWidth="0.8" strokeDasharray="1 5" />
          <path d={orbitArc(true, ORBIT_RX + 30, ORBIT_RY + 14)} stroke="#9fc4ff" strokeOpacity="0.18" strokeWidth="0.8" strokeDasharray="1 5" />
          <path d={orbitArc(false)} stroke="#b9d3ff" strokeOpacity="0.35" strokeWidth="1.1" />
        </g>

        {/* Far side: SVG fallback spheres behind the core. */}
        <g ref={backRef}>{PLANETS.map((planet, index) => (initial[index]!.depth < 0 ? planetNode(planet, index) : null))}</g>

        {/* Energy spokes core ↔ sphere; a pulse travels inward while animating. */}
        {PLANETS.map((planet, index) => (
          <g
            key={`arm-${index}`}
            ref={(el) => {
              armRefs.current[index] = el;
            }}
          >
            <line x1={CORE_R + 4} x2={CORE_R + 40} stroke={planet.color} strokeWidth={7} strokeOpacity={0.22} filter={`url(#${uid}-soft)`} />
            <line x1={CORE_R + 4} x2={CORE_R + 40} stroke={planet.color} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.9} />
            {animate ? (
              <line
                data-reverse="true"
                x1={CORE_R + 40}
                x2={CORE_R + 4}
                stroke="#ffffff"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeDasharray="6 70"
                style={{ "--travel": "-76px", animation: `consyrium-flow ${2.2 + index * 0.4}s linear infinite` } as CSSProperties}
              />
            ) : null}
          </g>
        ))}

        <g>
          <circle r={CORE_R + 6} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={10} opacity={0.45} filter={`url(#${uid}-glow)`} />
          <circle r={CORE_R} fill={`url(#${uid}-core)`} stroke={`url(#${uid}-rim)`} strokeWidth={2.5} />
          <circle r={CORE_R - 6} fill="none" stroke="#9fc4ff" strokeOpacity={0.12} strokeWidth={1} />
          <g transform="translate(-38.4 -38.4) scale(1.2)" fill="none">
            <MarkShapes stroke={`url(#${uid}-mark)`} />
            {/* Subtle electric shimmer on the ring – only while animating. */}
            {animate ? (
              <path
                d={RING_PATH}
                fill="none"
                stroke="#e9fbff"
                strokeWidth={1}
                strokeLinecap="round"
                strokeDasharray="6 40"
                opacity={0.75}
                style={{ "--travel": "-92px", animation: "consyrium-flow 4.5s linear infinite" } as CSSProperties}
              />
            ) : null}
          </g>
        </g>

        <path d={orbitArc(true)} fill="none" stroke="#b9d3ff" strokeOpacity="0.35" strokeWidth="1.1" />
        {/* Near side: SVG fallback spheres in front of the core. */}
        <g ref={frontRef}>{PLANETS.map((planet, index) => (initial[index]!.depth >= 0 ? planetNode(planet, index) : null))}</g>
      </svg>
      <canvas ref={frontCanvas} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
      {!reduced ? (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="absolute right-0 bottom-0 min-h-11 rounded-lg border border-glass-line bg-surface/60 px-3 py-2 text-xs text-muted hover:text-text"
        >
          {paused ? "Play animation" : "Pause animation"}
        </button>
      ) : null}
    </div>
  );
}
