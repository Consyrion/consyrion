"use client";

import { useEffect, useRef } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";

/** Illustration palette of the always-dark brand stage (does not follow the light/dark theme tokens). */
export const STAGE_COLORS = { violet: "#8b5cf6", blue: "#2f7bff", cyan: "#22d3ee", green: "#2ee6a8" } as const;

interface Bundle {
  /** Colours along the page width, left to right. */
  colors: string[];
  /** Baseline, amplitude and fan half-width as fractions of the height; wavelength as a fraction of the width. */
  base: number;
  amplitude: number;
  wavelength: number;
  spread: number;
  phase: number;
  /** Radians per second of the travelling wave. */
  speed: number;
  /** Peak opacity of a regular strand. */
  alpha: number;
}

const BUNDLES: Bundle[] = [
  { colors: [STAGE_COLORS.blue, STAGE_COLORS.cyan, STAGE_COLORS.violet], base: 0.6, amplitude: 0.14, wavelength: 0.85, spread: 0.05, phase: 2.3, speed: 0.22, alpha: 0.2 },
  { colors: [STAGE_COLORS.violet, STAGE_COLORS.blue, STAGE_COLORS.cyan], base: 0.63, amplitude: 0.11, wavelength: 0.7, spread: 0.035, phase: 3.1, speed: 0.3, alpha: 0.18 },
  { colors: [STAGE_COLORS.cyan, STAGE_COLORS.violet, STAGE_COLORS.blue], base: 0.56, amplitude: 0.07, wavelength: 1.1, spread: 0.03, phase: 1.0, speed: 0.18, alpha: 0.16 },
  { colors: [STAGE_COLORS.blue, STAGE_COLORS.blue, STAGE_COLORS.violet], base: 0.7, amplitude: 0.05, wavelength: 0.9, spread: 0.075, phase: 4.2, speed: 0.15, alpha: 0.08 },
];

const STRANDS = 28;
const STEP_PX = 22;
const FRAME_MS = 1000 / 30;

/** Deterministic pseudo-random numbers so stars and particles do not jump between renders. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Smoothed pointer for the interactive wave; `pull` 0…1 fades in while the pointer moves over the page. */
interface Pull {
  x: number;
  y: number;
  pull: number;
}

function strandY(b: Bundle, x: number, w: number, h: number, t: number, strand: number, pointer?: Pull) {
  const centre = h * (b.base + b.amplitude * Math.sin((2 * Math.PI * x) / (b.wavelength * w) + b.phase + b.speed * t));
  // The fan breathes but never collapses, so a bundle reads as one broad silk ribbon.
  const fan = b.spread * h * (0.55 + 0.45 * Math.sin((2 * Math.PI * x) / (b.wavelength * w * 0.7) + b.phase * 1.7 + b.speed * 0.6 * t));
  const wobble = 0.18 * b.spread * h * Math.sin(x * 0.004 + strand * 0.35 + t * 0.4);
  const y = centre + (strand / (STRANDS - 1) - 0.5) * 2 * fan + wobble;
  if (!pointer || pointer.pull < 0.01) return y;
  // The wave bends towards the pointer and its strands fan out a little around it.
  const near = Math.exp(-(((x - pointer.x) / (w * 0.14)) ** 2));
  return y + (pointer.y - centre) * 0.45 * near * pointer.pull + (strand / (STRANDS - 1) - 0.5) * fan * 0.8 * near * pointer.pull;
}

/**
 * Full-page light field of the sign-in stage (design concept in PR #78): silk ribbons of many fine strands sweeping
 * across the page, particles riding them and a star field. One fixed canvas behind the content; max 30 fps,
 * stopped when the tab is hidden and a single still frame for reduced motion.
 */
/** `intensity` scales strand brightness (1 = sign-in default; the homepage uses a stronger wave). */
export function RibbonField({ className = "", intensity = 1, interactive = false }: { className?: string; intensity?: number; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const elapsed = useRef(0);
  const running = !reduced && visible;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rand = seeded(11);
    const stars = Array.from({ length: 170 }, () => ({ x: rand(), y: rand(), r: 0.3 + rand() * 0.9, a: 0.12 + rand() * 0.5, tw: rand() * 6 }));
    const particles = Array.from({ length: 240 }, () => ({
      bundle: Math.floor(rand() * 3),
      u: rand(),
      lane: rand(),
      speed: 0.006 + rand() * 0.02,
      r: 0.5 + rand() * 1.3,
      tw: rand() * 6,
    }));
    let w = 0;
    let h = 0;
    const pull: Pull = { x: 0, y: 0, pull: 0 };
    const target = { x: 0, y: 0, on: false };
    const onPointer = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
      target.on = true;
    };
    const onLeave = () => {
      target.on = false;
    };
    if (interactive) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      pull.x += (target.x - pull.x) * 0.12;
      pull.y += (target.y - pull.y) * 0.12;
      pull.pull += ((target.on ? 1 : 0) - pull.pull) * 0.05;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#cfe8ff";
      for (const s of stars) {
        ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(t * 0.8 + s.tw));
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Narrow screens get calmer ribbons so the form stays the focus.
      const strength = (w < 768 ? 0.55 : 1) * intensity;
      for (const bundle of BUNDLES) {
        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        bundle.colors.forEach((color, i) => gradient.addColorStop(i / (bundle.colors.length - 1), color));
        ctx.strokeStyle = gradient;
        for (let strand = 0; strand < STRANDS; strand++) {
          const core = strand === Math.floor(STRANDS / 2);
          const sheen = strand % 7 === 3;
          ctx.beginPath();
          for (let x = -STEP_PX; x <= w + STEP_PX; x += STEP_PX) {
            const y = strandY(bundle, x, w, h, t, strand, interactive ? pull : undefined);
            if (x === -STEP_PX) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineWidth = core ? 1.8 : sheen ? 1 : 0.6;
          ctx.globalAlpha = strength * (core ? Math.min(1, bundle.alpha * 4.5) : sheen ? bundle.alpha * 2 : bundle.alpha);
          ctx.stroke();
          if (core) {
            // Soft glow under the bright core strand.
            ctx.lineWidth = 10;
            ctx.globalAlpha = strength * bundle.alpha * 0.8;
            ctx.stroke();
          }
        }
      }
      for (const p of particles) {
        const bundle = BUNDLES[p.bundle]!;
        const u = (p.u + p.speed * t) % 1;
        const x = u * w;
        const y = strandY(bundle, x, w, h, t, Math.round(p.lane * (STRANDS - 1)), interactive ? pull : undefined);
        ctx.globalAlpha = strength * 0.85 * Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(t * 2 + p.tw));
        ctx.fillStyle = bundle.colors[Math.min(bundle.colors.length - 1, Math.floor(u * bundle.colors.length))]!;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    resize();
    draw(elapsed.current);
    const observer = new ResizeObserver(() => {
      resize();
      draw(elapsed.current);
    });
    observer.observe(canvas);
    const stopPointer = () => {
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
    if (!running) {
      stopPointer();
      return () => observer.disconnect();
    }

    let frame = 0;
    let last = performance.now();
    let lastDraw = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      elapsed.current += Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now;
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw(elapsed.current);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stopPointer();
    };
  }, [running, intensity, interactive]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 size-full ${className}`} data-ribbons={running ? "on" : "off"} />;
}
