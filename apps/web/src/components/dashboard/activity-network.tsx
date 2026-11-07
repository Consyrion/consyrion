"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MarkShapes } from "../brand/consyrion-logo";
import { PROVIDER_COLOR, PROVIDER_NAME, type ActivityNode } from "./activity-network-data";
import type { NodeState } from "./council-network";
import { ease, pointerPull, svgPoint } from "./pointer-field";

const W = 760;
const H = 320;
const CX = 340;
const CY = 160;
const HEX_R = 70;
const NODE_R = 31;

/** Slots around the central decision hexagon, in the order of design concept 1: left, right top, right bottom, … */
const SLOTS: Array<{ x: number; y: number; label: "below" | "right" | "left" }> = [
  { x: 120, y: 150, label: "below" },
  { x: 560, y: 78, label: "right" },
  { x: 560, y: 236, label: "right" },
  { x: 120, y: 48, label: "right" },
  { x: 120, y: 262, label: "right" },
  { x: 610, y: 158, label: "left" },
];

/** Deterministic star field so server and client render the same markup. */
const STARS = Array.from({ length: 70 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12543.123;
  return { x: (a - Math.floor(a)) * W, y: (b - Math.floor(b)) * H, r: 0.4 + ((((a * 7) % 1) + 1) % 1) * 0.9, o: 0.15 + ((((b * 3) % 1) + 1) % 1) * 0.5 };
});

/** Glyph inside a node ring, per provider (concept: rings, star, ring). */
function Glyph({ provider, color }: { provider: string; color: string }) {
  if (provider === "anthropic") return <path d="M0 -13 L3.5 -3.5 L13 0 L3.5 3.5 L0 13 L-3.5 3.5 L-13 0 L-3.5 -3.5 Z" fill="#ffffff" />;
  if (provider === "google") return <circle r={11} fill="none" stroke="#ffffff" strokeWidth={3.5} />;
  if (provider === "deepseek") return <path d="M0 -12 L10.4 -6 L10.4 6 L0 12 L-10.4 6 L-10.4 -6 Z" fill="none" stroke="#ffffff" strokeWidth={3} />;
  return (
    <g fill="none" stroke="#ffffff">
      <circle r={13} strokeWidth={2.5} />
      <circle r={7} strokeWidth={2.5} stroke={color} />
    </g>
  );
}

function StatusIcon({ state, color }: { state: NodeState; color: string }) {
  if (state === "done")
    return (
      <g>
        <circle r={6.5} fill="rgb(46 230 168 / 0.18)" stroke="#2ee6a8" strokeWidth={1.2} />
        <path d="M-3 0 l2 2 l4 -4.5" fill="none" stroke="#2ee6a8" strokeWidth={1.5} strokeLinecap="round" />
      </g>
    );
  if (state === "failed") return <circle r={5} fill="none" stroke="var(--danger)" strokeWidth={2} />;
  if (state === "working") return <circle r={5} fill="none" stroke={color} strokeWidth={2} strokeDasharray="22 10" />;
  return <circle r={5} fill="none" stroke="#2ee6a8" strokeWidth={1.5} />;
}

interface Point {
  x: number;
  y: number;
}

/** One silk ribbon of fine strands from a node to the hexagon; strands fan out in the middle. */
function ribbon(from: Point, to: Point, strands: number) {
  const dx = to.x - from.x;
  const paths: string[] = [];
  for (let k = 0; k < strands; k++) {
    const t = strands === 1 ? 0 : k / (strands - 1) - 0.5;
    const c1 = { x: from.x + dx * 0.45, y: from.y + t * 46 };
    const c2 = { x: from.x + dx * 0.55, y: to.y - t * 46 };
    paths.push(
      `M${from.x.toFixed(1)} ${(from.y + t * 6).toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${to.x.toFixed(1)} ${(to.y + t * 8).toFixed(1)}`,
    );
  }
  return paths;
}

/** Start and end of the link of slot `i`: from the node ring to the facing side of the hexagon. */
function linkEnds(i: number): [Point, Point] {
  const slot = SLOTS[i]!;
  const toLeft = slot.x > CX;
  return [
    { x: slot.x + (toLeft ? -NODE_R - 2 : NODE_R + 2), y: slot.y },
    { x: CX + (toLeft ? HEX_R * 0.86 : -HEX_R * 0.86), y: CY + (slot.y - CY) * 0.25 },
  ];
}

/** Control points of the core strand (the same curve `ribbon` draws for a single strand). */
function coreCurve(from: Point, to: Point): Point[] {
  const dx = to.x - from.x;
  return [from, { x: from.x + dx * 0.45, y: from.y }, { x: from.x + dx * 0.55, y: to.y }, to];
}

function bezier(curve: Point[], t: number): Point {
  const [p0, p1, p2, p3] = curve as [Point, Point, Point, Point];
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Jagged discharge along the curve: random sideways offsets that fade out at both ends. */
function arcPath(curve: Point[], amplitude: number) {
  const steps = 16;
  let d = "";
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const p = bezier(curve, t);
    const q = bezier(curve, Math.min(1, t + 0.01));
    const nx = p.y - q.y;
    const ny = q.x - p.x;
    const len = Math.hypot(nx, ny) || 1;
    const offset = (Math.random() * 2 - 1) * amplitude * Math.sin(Math.PI * t);
    d += `${k ? "L" : "M"}${(p.x + (nx / len) * offset).toFixed(1)} ${(p.y + (ny / len) * offset).toFixed(1)}`;
  }
  return d;
}

/** Short jagged arc hugging a node ring: the crackle of a zap. */
function coronaPath(cx: number, cy: number) {
  const start = Math.random() * Math.PI * 2;
  const span = 1.2 + Math.random() * 1.8;
  let d = "";
  for (let k = 0; k <= 10; k++) {
    const a = start + (span * k) / 10;
    const radius = NODE_R + 3 + Math.random() * 6;
    d += `${k ? "L" : "M"}${(cx + Math.cos(a) * radius).toFixed(1)} ${(cy + Math.sin(a) * radius).toFixed(1)}`;
  }
  return d;
}

function NodeCard({ node, slot, id }: { node: ActivityNode; slot: (typeof SLOTS)[number]; id: string }) {
  const color = node.state === "failed" ? "var(--danger)" : (PROVIDER_COLOR[node.provider] ?? "#22d3ee");
  const details = node.details;
  const right = slot.x > CX;
  // Next to the node, on the side facing the centre; vertically kept inside the graphic.
  const style: CSSProperties = {
    top: `${(slot.y / H) * 100}%`,
    transform: `translateY(${slot.y < 100 ? "-18%" : slot.y > 220 ? "-82%" : "-50%"})`,
    borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
    ...(right ? { right: `${(1 - (slot.x - NODE_R - 14) / W) * 100}%` } : { left: `${((slot.x + NODE_R + 14) / W) * 100}%` }),
  };
  const roles = details?.roles ?? [];
  const t = useTranslations("dashboard");
  const format = useFormatter();
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none absolute z-10 w-72 max-w-[75%] rounded-xl border bg-[#071226]/90 p-3.5 text-left text-[13px] text-[#c7d2e8] shadow-[0_14px_40px_rgb(0_0_0/0.5)] backdrop-blur-md [animation:consyrion-card-in_160ms_ease-out]"
      style={style}
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <span className="font-semibold text-[#e8eefc]">{PROVIDER_NAME[node.provider] ?? node.provider}</span>
        <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[11px]">{t(`nodeState.${node.state}`)}</span>
      </div>
      <p className="mt-1 font-mono text-[11.5px] break-all text-[#9aa9c6]">{node.model}</p>
      <p className="mt-2">{t(`activity.hint.${node.state}`)}</p>
      {details?.sessions ? <p className="mt-1 text-[12px] text-[#9aa9c6]">{t("activity.sessions", { n: details.sessions })}</p> : null}
      {details ? (
        <>
          <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5">
            {[
              [t("activity.requests"), details.calls],
              [t("activity.tokensIn"), details.inputTokens],
              [t("activity.tokensOut"), details.outputTokens],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10.5px] tracking-wider text-[#7f8db0] uppercase">{label}</dt>
                <dd className="text-[15px] font-semibold text-[#e8eefc] tabular-nums">
                  {format.number(value as number, { notation: "compact", maximumFractionDigits: 1 })}
                </dd>
              </div>
            ))}
          </dl>
          {details.failedCalls ? (
            <p className="mt-2 text-[12px] text-[#fbbf24]">{t("activity.failed", { failed: details.failedCalls, calls: details.calls })}</p>
          ) : null}
          {roles.length ? (
            <ul className="mt-2.5 flex flex-wrap gap-1" aria-label={t("activity.perspectives")}>
              {roles.slice(0, 4).map((role) => (
                <li
                  key={role}
                  className="rounded-full border px-2 py-0.5 text-[11px]"
                  style={{ borderColor: `color-mix(in oklab, ${color} 50%, transparent)` }}
                >
                  {role}
                </li>
              ))}
              {roles.length > 4 ? <li className="px-1 py-0.5 text-[11px] text-[#9aa9c6]">{t("activity.more", { n: roles.length - 4 })}</li> : null}
            </ul>
          ) : null}
          {details.failureReason ? <p className="mt-2 text-[12px] text-[#fca5a5]">{details.failureReason}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Council activity network (design concept 1): models around a central decision hexagon in a nebula, linked by
 * silk ribbons of fine strands. The graphic is always slightly alive: nodes tremble in place, small discharges
 * crackle along the links and sparks travel to the centre – stronger for a model with a request in flight.
 * Nodes lean towards a nearby mouse pointer and crackle when it comes close; the hexagon swells and glows
 * brighter under it. Hovering or focusing a model shows a card with its real figures. Reduced motion keeps the
 * static graphic.
 */
export function ActivityNetwork({ nodes, centerTitle, centerSubtitle }: { nodes: ActivityNode[]; centerTitle: string; centerSubtitle: string }) {
  const t = useTranslations("dashboard");
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(CX + HEX_R * Math.cos(a)).toFixed(1)},${(CY + HEX_R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const summary = nodes.map((n) => `${PROVIDER_NAME[n.provider] ?? n.provider} ${n.model}: ${t(`nodeState.${n.state}`)}`).join(", ");
  const shown = nodes.slice(0, SLOTS.length);
  const [active, setActive] = useState<number | null>(null);
  const figureRef = useRef<HTMLElement>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const arcRefs = useRef<Array<SVGPathElement | null>>([]);
  const sparkRefs = useRef<Array<SVGCircleElement | null>>([]);
  const coronaRefs = useRef<Array<SVGPathElement | null>>([]);
  const hexGlowRef = useRef<SVGPolygonElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const coreRef = useRef<SVGGElement>(null);
  // Pointer in viewBox units, read by the animation loop (no re-render per mouse move).
  const pointerRef = useRef<Point | null>(null);
  const states = shown.map((n) => n.state).join(",");

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure || !states || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodeStates = states.split(",") as NodeState[];
    const curves = nodeStates.map((_, i) => coreCurve(...linkEnds(i)));
    // A "zap" is a short burst of stronger trembling and a brighter discharge; working models zap more often.
    const zaps = nodeStates.map(() => ({ until: 0, next: performance.now() + 300 + Math.random() * 1500 }));
    // Eased pointer reaction per node (lean x/y) and for the hexagon, so movements glide instead of jumping.
    const lean = nodeStates.map(() => ({ x: 0, y: 0 }));
    let coreNear = 0;
    let frame = 0;
    let visible = true;
    let lastArc = 0;
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const t = now / 1000;
      const redraw = now - lastArc > 90;
      if (redraw) lastArc = now;
      const pointer = pointerRef.current;
      coreNear = ease(coreNear, pointerPull(pointer, CX, CY, HEX_R + 70).strength);
      nodeStates.forEach((state, i) => {
        const zap = zaps[i]!;
        const slot = SLOTS[i]!;
        const pull = pointerPull(pointer, slot.x, slot.y, 150);
        lean[i]!.x = ease(lean[i]!.x, pull.ux * pull.strength * 9);
        lean[i]!.y = ease(lean[i]!.y, pull.uy * pull.strength * 9);
        // A close pointer charges the node: it zaps soon, whatever its state.
        if (pull.strength > 0.45 && zap.next - now > 260) zap.next = now + 120 + Math.random() * 200;
        if (now > zap.next && (state !== "idle" || pull.strength > 0.45)) {
          zap.until = now + 90 + Math.random() * 110;
          zap.next = now + (state === "working" ? 700 : 1600) + Math.random() * 2400;
        }
        const zapping = now < zap.until;
        const strength = state === "working" ? 1.7 : state === "idle" ? 0.6 : 1.2;
        let dx = (Math.sin(t * 1.3 + i * 1.7) * 1.8 + Math.sin(t * 3.7 + i * 2.3) * 0.6) * strength + lean[i]!.x;
        let dy = (Math.cos(t * 1.1 + i * 2.3) * 1.8 + Math.sin(t * 4.3 + i * 1.7) * 0.6) * strength + lean[i]!.y;
        if (zapping) {
          dx += (Math.random() * 2 - 1) * 2;
          dy += (Math.random() * 2 - 1) * 2;
        }
        nodeRefs.current[i]?.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
        if (redraw) {
          // Brightness varies within a narrow band; only zaps are brighter (no strobing).
          const base = state === "working" ? 0.6 : state === "done" ? 0.38 : state === "failed" ? 0.12 : 0.1;
          for (let k = 0; k < 2; k++) {
            const arc = arcRefs.current[i * 2 + k];
            if (!arc) continue;
            arc.setAttribute("d", arcPath(curves[i]!, (k ? 8 : 4.5) * (zapping ? 1.7 : 1)));
            // The hexagon under the pointer draws more current through every link.
            arc.setAttribute("opacity", Math.min(1, base * (1 + coreNear * 1.5) * (zapping ? 1.8 : 0.75 + Math.random() * 0.25) * (k ? 0.6 : 1)).toFixed(2));
          }
          const corona = coronaRefs.current[i];
          if (corona) {
            corona.setAttribute("d", zapping ? coronaPath(slot.x, slot.y) : "");
            corona.setAttribute("opacity", zapping ? (state === "failed" ? "0.4" : "0.85") : "0");
          }
        }
        for (let k = 0; k < 2; k++) {
          const spark = sparkRefs.current[i * 2 + k];
          if (!spark) continue;
          if (state === "failed" || state === "idle") {
            spark.setAttribute("opacity", "0");
            continue;
          }
          const along = (t * (state === "working" ? 0.5 : 0.2) + k * 0.5 + i * 0.13) % 1;
          const p = bezier(curves[i]!, along);
          spark.setAttribute("cx", p.x.toFixed(1));
          spark.setAttribute("cy", p.y.toFixed(1));
          spark.setAttribute("opacity", (Math.sin(Math.PI * along) * (state === "working" ? 1 : 0.6)).toFixed(2));
        }
      });
      hexGlowRef.current?.setAttribute("stroke-opacity", (0.32 + Math.sin(t * 1.6) * 0.1 + coreNear * 0.45).toFixed(2));
      const scale = 1 + Math.sin(t * 1.6) * 0.008 + coreNear * 0.05;
      coreRef.current?.setAttribute("transform", `translate(${CX} ${CY}) scale(${scale.toFixed(4)}) translate(${-CX} ${-CY})`);
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(tick);
    };
    // Only animate while the graphic is on screen and the tab is visible.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      resume();
    });
    observer.observe(figure);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [states]);

  const activeNode = active != null ? shown[active] : undefined;
  return (
    <figure
      ref={figureRef}
      className="relative"
      onPointerMove={(event) => {
        if (svgRef.current) pointerRef.current = svgPoint(event, svgRef.current, W, H);
      }}
      onPointerLeave={() => {
        pointerRef.current = null;
        setActive(null);
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded-2xl"
        role="group"
        aria-label={`${centerTitle} – ${centerSubtitle}. ${summary || t("activity.none")}`}
      >
        <defs>
          <radialGradient id="an-neb-a" cx="0.3" cy="0.55" r="0.5">
            <stop offset="0" stopColor="#2f7bff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#2f7bff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="an-neb-b" cx="0.78" cy="0.25" r="0.45">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.28" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="an-neb-c" cx="0.75" cy="0.85" r="0.4">
            <stop offset="0" stopColor="#2ee6a8" stopOpacity="0.16" />
            <stop offset="1" stopColor="#2ee6a8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="an-hex" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0f2a4d" />
            <stop offset="1" stopColor="#06101f" />
          </linearGradient>
          <linearGradient id="an-mark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="an-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="an-soft" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
          <filter id="an-zap" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {shown.map((node, i) => {
            const slot = SLOTS[i]!;
            return (
              <linearGradient key={node.id} id={`an-link-${i}`} gradientUnits="userSpaceOnUse" x1={slot.x} y1={slot.y} x2={CX} y2={CY}>
                <stop offset="0" stopColor={PROVIDER_COLOR[node.provider] ?? "#22d3ee"} />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            );
          })}
        </defs>

        <rect width={W} height={H} fill="#050b1a" />
        <rect width={W} height={H} fill="url(#an-neb-a)" />
        <rect width={W} height={H} fill="url(#an-neb-b)" />
        <rect width={W} height={H} fill="url(#an-neb-c)" />
        <g aria-hidden="true" fill="#cfe8ff">
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(2)} opacity={s.o.toFixed(2)} />
          ))}
        </g>

        {shown.map((node, i) => {
          const [from, to] = linkEnds(i);
          const strands = ribbon(from, to, 9);
          const core = ribbon(from, to, 1)[0]!;
          const working = node.state === "working";
          const dim = node.state === "idle";
          const opacity = active === i ? 1 : active != null ? 0.3 : dim ? 0.45 : 1;
          return (
            <g
              key={`link-${node.id}`}
              aria-hidden="true"
              fill="none"
              stroke={`url(#an-link-${i})`}
              opacity={opacity}
              className="transition-opacity duration-200"
            >
              <path d={core} strokeWidth={14} strokeOpacity={active === i ? 0.45 : 0.25} filter="url(#an-soft)" />
              {strands.map((d, k) => (
                <path key={k} d={d} strokeWidth={0.7} strokeOpacity={0.35} />
              ))}
              <path
                d={core}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeDasharray={working ? "10 14" : undefined}
                style={working ? ({ "--travel": "-96px", animation: "consyrion-flow 1.4s linear infinite" } as CSSProperties) : undefined}
              />
              {[0, 1].map((k) => (
                <path
                  key={`arc-${k}`}
                  ref={(el) => void (arcRefs.current[i * 2 + k] = el)}
                  d=""
                  opacity={0}
                  stroke="#e6f6ff"
                  strokeWidth={k ? 0.8 : 1.2}
                  strokeLinejoin="round"
                  filter="url(#an-zap)"
                />
              ))}
              {[0, 1].map((k) => (
                <circle
                  key={`spark-${k}`}
                  ref={(el) => void (sparkRefs.current[i * 2 + k] = el)}
                  r={2.4}
                  fill="#ffffff"
                  stroke="none"
                  opacity={0}
                  filter="url(#an-zap)"
                />
              ))}
            </g>
          );
        })}

        <g ref={coreRef}>
          <polygon ref={hexGlowRef} points={hex} fill="none" stroke="#22d3ee" strokeWidth={12} strokeOpacity={0.35} filter="url(#an-glow)" />
          <polygon points={hex} fill="url(#an-hex)" stroke="#22d3ee" strokeWidth={2} />
          {/* Original mark, large enough to read as the brand centre. */}
          <g transform={`translate(${CX - 24} ${CY - 50}) scale(0.75)`} fill="none">
            <MarkShapes stroke="url(#an-mark)" />
          </g>
          <text x={CX} y={CY + 20} textAnchor="middle" fontSize={13} fontWeight={700} letterSpacing={2.5} fill="#e8eefc">
            {centerTitle}
          </text>
          <text x={CX} y={CY + 36} textAnchor="middle" fontSize={11} fill="#9aa9c6">
            {centerSubtitle}
          </text>
        </g>

        {shown.map((node, i) => {
          const slot = SLOTS[i]!;
          const color = node.state === "failed" ? "var(--danger)" : (PROVIDER_COLOR[node.provider] ?? "#22d3ee");
          const name = PROVIDER_NAME[node.provider] ?? node.provider;
          const model = node.model.length > 24 ? `${node.model.slice(0, 23)}…` : node.model;
          const lx = slot.label === "below" ? slot.x : slot.label === "right" ? slot.x + NODE_R + 14 : slot.x - NODE_R - 14;
          const ly = slot.label === "below" ? slot.y + NODE_R + 22 : slot.y - 8;
          const anchor = slot.label === "below" ? "middle" : slot.label === "right" ? "start" : "end";
          const isActive = active === i;
          return (
            <g
              key={node.id}
              data-node-state={node.state}
              role="button"
              tabIndex={0}
              aria-label={`${name} ${node.model}: ${t(`nodeState.${node.state}`)}`}
              aria-describedby={isActive ? `an-card-${i}` : undefined}
              className="cursor-pointer outline-none transition-opacity duration-200 [&:focus-visible_.an-focus]:opacity-100"
              opacity={active != null && !isActive ? 0.55 : 1}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((current) => (current === i ? null : current))}
              onClick={() => setActive((current) => (current === i ? null : i))}
              onKeyDown={(event) => {
                if (event.key === "Escape") setActive(null);
              }}
            >
              {/* Hit area so the card opens over the whole node, not only over painted pixels. */}
              <circle cx={slot.x} cy={slot.y} r={NODE_R + 12} fill="transparent" />
              <g ref={(el) => void (nodeRefs.current[i] = el)}>
                {node.state === "working" ? (
                  <circle
                    cx={slot.x}
                    cy={slot.y}
                    r={44}
                    fill={color}
                    opacity={0.16}
                    style={{ transformOrigin: `${slot.x}px ${slot.y}px`, animation: "consyrion-pulse 1.8s ease-in-out infinite" }}
                    data-pulse="true"
                  />
                ) : null}
                <circle cx={slot.x} cy={slot.y} r={NODE_R + 6} fill={color} opacity={isActive ? 0.6 : 0.35} filter="url(#an-glow)" />
                <circle cx={slot.x} cy={slot.y} r={NODE_R} fill="#071226" stroke={color} strokeWidth={isActive ? 4 : 3} />
                <circle cx={slot.x} cy={slot.y} r={NODE_R - 5} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />
                <path
                  ref={(el) => void (coronaRefs.current[i] = el)}
                  d=""
                  opacity={0}
                  fill="none"
                  stroke={node.state === "failed" ? color : "#e6f6ff"}
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                  filter="url(#an-zap)"
                />
                <circle
                  className="an-focus opacity-0"
                  cx={slot.x}
                  cy={slot.y}
                  r={NODE_R + 9}
                  fill="none"
                  stroke="#e8eefc"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <g transform={`translate(${slot.x} ${slot.y})`}>
                  <Glyph provider={node.provider} color={color} />
                </g>
              </g>
              <text x={lx} y={ly} textAnchor={anchor} fontSize={15} fontWeight={700} fill="#e8eefc">
                {name}
              </text>
              <text x={lx} y={ly + 17} textAnchor={anchor} fontSize={11.5} fill="#9aa9c6">
                {model}
              </text>
              <g transform={`translate(${anchor === "middle" ? lx - 28 : anchor === "start" ? lx + 6 : lx - 52} ${ly + 33})`}>
                <StatusIcon state={node.state} color={color} />
                <text x={11} y={4} fontSize={11.5} fill={node.state === "done" ? "#2ee6a8" : "#c7d2e8"}>
                  {t(`nodeState.${node.state}`)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      {activeNode ? <NodeCard node={activeNode} slot={SLOTS[active!]!} id={`an-card-${active}`} /> : null}
    </figure>
  );
}
