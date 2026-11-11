"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";
import { MarkShapes } from "./consyrium-logo";
import { EXECUTION_PATH, MARK_VIEWBOX, RING_LENGTH, RING_PATH } from "./geometry";

export type ElectricMode = "ambient" | "hover" | "intro";

interface ElectricLogoProps {
  size?: number;
  /**
   * ambient: restrained loop (hero); intro: one short run after load, then on hover/focus (navbar);
   * hover: only while the pointer or keyboard focus is on the logo.
   */
  mode?: ElectricMode;
  /** Accessible name; pass "" when visible text next to the logo already names it. */
  title?: string;
  className?: string;
}

const INTRO_MS = 2_600;

/** Dash pattern plus a seamless travel distance (whole periods) for the consyrium-flow keyframes. */
function flow(dash: number, gap: number, periods: number, duration: string, reverse = false) {
  return {
    strokeDasharray: `${dash} ${gap}`,
    style: { "--travel": `${-(dash + gap) * periods}px`, animation: `consyrium-flow ${duration} linear infinite${reverse ? " reverse" : ""}` } as CSSProperties,
  };
}

const SPARK = flow(RING_LENGTH * 0.12, RING_LENGTH * 0.2, 3, "2.2s");
const ARC = flow(RING_LENGTH * 0.05, RING_LENGTH * 0.35, 2, "3.4s", true);
const EXECUTION = flow(4, 6, 4, "1.6s");

/**
 * Original CONSYRIUM AI Electric Logo (issue #67). Electric sparks run along the mark's outline: dashed
 * strokes travel the ring while an animated turbulence filter makes them crackle. Pure SVG/CSS – no
 * WebGL, no third-party code. With reduced motion, a hidden tab or before hydration only the static mark
 * is rendered, so the logo is always recognisable.
 */
export function ElectricLogo({ size = 40, mode = "intro", title = "CONSYRIUM AI", className = "" }: ElectricLogoProps) {
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const [hovering, setHovering] = useState(false);
  const [intro, setIntro] = useState(mode === "intro");
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    if (mode !== "intro") return;
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const electric = !reduced && visible && (mode === "ambient" || hovering || intro);
  const decorative = title === "";
  const gradient = `url(#${uid}-g)`;

  return (
    <span
      className={`inline-flex shrink-0 ${className}`}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      data-electric={electric ? "on" : "off"}
    >
      <svg
        width={size}
        height={size}
        viewBox={MARK_VIEWBOX}
        fill="none"
        overflow="visible"
        role={decorative ? undefined : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : title}
      >
        <defs>
          <linearGradient id={`${uid}-g`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--primary)" />
            <stop offset="0.55" stopColor="var(--success)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
          {electric ? (
            <>
              <filter id={`${uid}-crackle`} x="-30%" y="-30%" width="160%" height="160%">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="2" result="noise">
                  <animate attributeName="seed" values="1;4;2;6;3;5" dur="0.7s" calcMode="discrete" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="jitter" />
                <feGaussianBlur in="jitter" stdDeviation="0.9" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="jitter" />
                </feMerge>
              </filter>
              <filter id={`${uid}-halo`} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="2.4" />
              </filter>
            </>
          ) : null}
        </defs>

        {electric ? <path d={RING_PATH} stroke="var(--primary)" strokeWidth={7} strokeLinecap="round" opacity={0.28} filter={`url(#${uid}-halo)`} /> : null}
        <MarkShapes stroke={gradient} />
        {electric ? (
          <g filter={`url(#${uid}-crackle)`} strokeLinecap="round">
            <path d={RING_PATH} stroke="#e9fbff" strokeWidth={1.6} {...SPARK} />
            <path d={RING_PATH} stroke="var(--magenta)" strokeWidth={1.1} {...ARC} />
            <path d={EXECUTION_PATH} stroke="var(--primary)" strokeWidth={1.4} {...EXECUTION} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
