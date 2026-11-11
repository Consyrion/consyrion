"use client";

import { useEffect, useRef } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";

interface Ribbon {
  /** Vertical centre as a fraction of the height. */
  y: number;
  amplitude: number;
  wavelength: number;
  speed: number;
  /** CSS variable holding the ribbon colour. */
  color: string;
  lines: number;
  spread: number;
}

const RIBBONS: Ribbon[] = [
  { y: 0.62, amplitude: 0.09, wavelength: 0.9, speed: 0.05, color: "--primary", lines: 16, spread: 0.07 },
  { y: 0.7, amplitude: 0.12, wavelength: 1.3, speed: -0.035, color: "--accent", lines: 12, spread: 0.06 },
  { y: 0.55, amplitude: 0.06, wavelength: 0.7, speed: 0.025, color: "--success", lines: 8, spread: 0.04 },
];

const FRAME_MS = 1000 / 24;
const MAX_DPR = 1.5;

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, colors: string[]) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  RIBBONS.forEach((ribbon, ribbonIndex) => {
    ctx.strokeStyle = colors[ribbonIndex]!;
    for (let line = 0; line < ribbon.lines; line++) {
      const offset = (line / ribbon.lines - 0.5) * ribbon.spread * height;
      ctx.globalAlpha = 0.05 + 0.1 * (1 - Math.abs(line / ribbon.lines - 0.5) * 2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 12) {
        const u = x / width;
        const phase = u / ribbon.wavelength + time * ribbon.speed + line * 0.018;
        const y = ribbon.y * height + offset + Math.sin(phase * Math.PI * 2) * ribbon.amplitude * height + Math.sin((u * 3 + time * 0.02 + line * 0.05) * Math.PI) * 6;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Atmospheric background (issue #67): soft light fields, a faint drifting grid and slowly flowing
 * cyan/violet/emerald ribbons on a canvas. Purely decorative: it sits behind content, never intercepts
 * input, renders a single still frame for reduced motion and stops while the tab or the element is hidden.
 */
export function AmbientBackground({ className = "", intensity = 1 }: { className?: string; intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    let last = 0;
    let onScreen = true;
    let width = 0;
    let height = 0;
    const styles = getComputedStyle(document.documentElement);
    const colors = RIBBONS.map((r) => styles.getPropertyValue(r.color).trim() || "#00d8ff");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, width, height, performance.now() / 1000, colors);
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!onScreen || now - last < FRAME_MS) return;
      last = now;
      draw(ctx, width, height, now / 1000, colors);
    };

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const viewObserver = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
    });
    viewObserver.observe(canvas);
    resize();
    if (!reduced && visible) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      viewObserver.disconnect();
    };
  }, [reduced, visible]);

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`} data-testid="ambient-background">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 10%, var(--glow-cyan), transparent 70%), radial-gradient(50% 45% at 90% 20%, var(--glow-violet), transparent 70%), linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%)",
          opacity: 0.55 * intensity + 0.2,
        }}
      />
      <div
        className="absolute inset-[-80px]"
        style={{
          backgroundImage: "linear-gradient(var(--glass-line) 1px, transparent 1px), linear-gradient(90deg, var(--glass-line) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(70% 60% at 50% 40%, black 30%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 40%, black 30%, transparent 80%)",
          opacity: 0.6,
          animation: "consyrium-drift 48s linear infinite",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ opacity: 0.9 * intensity }} />
    </div>
  );
}
