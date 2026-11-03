import { EXECUTION_NODE, EXECUTION_PATH, MARK_VIEWBOX, PHASE_NODES, RING_PATH, VERDICT_NODE } from "./geometry";

interface MarkProps {
  size?: number;
  /** Accessible name; pass an empty string when the mark sits next to visible "CONSYRION AI" text. */
  title?: string;
  className?: string;
  /** Unique gradient id when several marks with different colours share a page. */
  gradientId?: string;
}

/** Static CONSYRION AI mark. Works without JavaScript and is the reduced-motion fallback of the Electric Logo. */
export function ConsyrionMark({ size = 40, title = "CONSYRION AI", className = "", gradientId = "consyrion-mark-gradient" }: MarkProps) {
  const decorative = title === "";
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
      fill="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="0.55" stopColor="var(--success)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <MarkShapes stroke={`url(#${gradientId})`} />
    </svg>
  );
}

/** The mark's shapes without the surrounding <svg>, so animated variants can layer effects on top. */
export function MarkShapes({ stroke }: { stroke: string }) {
  return (
    <g>
      <path d={RING_PATH} stroke={stroke} strokeWidth={4.2} strokeLinecap="round" />
      <path d={EXECUTION_PATH} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      {PHASE_NODES.map((node, index) => (
        <circle key={index} cx={node.x} cy={node.y} r={3.1} fill="var(--bg)" stroke={stroke} strokeWidth={2.2} />
      ))}
      <circle cx={VERDICT_NODE.x} cy={VERDICT_NODE.y} r={VERDICT_NODE.r} fill={stroke} />
      <circle cx={EXECUTION_NODE.x} cy={EXECUTION_NODE.y} r={EXECUTION_NODE.r} fill={stroke} />
    </g>
  );
}

/** Text wordmark in the display face; kept as live text so it stays selectable and readable by screen readers. */
export function ConsyrionWordmark({ className = "" }: { className?: string }) {
  return <span className={`font-[family-name:var(--font-display)] font-semibold tracking-[0.28em] ${className}`}>CONSYRION AI</span>;
}
