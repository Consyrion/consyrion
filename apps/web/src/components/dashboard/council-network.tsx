"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, type CSSProperties } from "react";
import { ease, pointerPull, svgPoint } from "./pointer-field";

export type NodeState = "idle" | "working" | "done" | "failed";

export interface CouncilNode {
  id: string;
  label: string;
  sublabel?: string;
  state: NodeState;
}

const NODE_COLOR: Record<NodeState, string> = {
  idle: "var(--muted)",
  working: "var(--primary)",
  done: "var(--success)",
  failed: "var(--danger)",
};

/**
 * The council as a network: one luminous node per model around the verdict node. Pulses and flowing
 * links appear only for nodes whose state is "working" – i.e. a real call is in flight – so the picture
 * never suggests models are thinking while they are idle. Every node floats gently in place (its link follows)
 * and leans towards a nearby mouse pointer, growing under it; the centre swells under the pointer. Reduced
 * motion keeps the static graphic.
 */
export function CouncilNetwork({ nodes, centerLabel, caption, className = "" }: { nodes: CouncilNode[]; centerLabel?: string; caption?: string; className?: string }) {
  const t = useTranslations("dashboard.network");
  const size = 320;
  const c = size / 2;
  const radius = nodes.length > 6 ? 120 : 108;
  const placed = nodes.map((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return { ...node, x: c + radius * Math.cos(angle), y: c + radius * Math.sin(angle) };
  });
  const summary = nodes.map((n) => `${n.label}: ${t(`state.${n.state}`)}`).join(", ");
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const coreRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const linkRefs = useRef<Array<SVGLineElement | null>>([]);
  const positions = placed.map((p) => `${p.x.toFixed(1)}:${p.y.toFixed(1)}`).join(",");

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !positions || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const points = positions.split(",").map((pair) => pair.split(":").map(Number) as [number, number]);
    // Eased reactions, so nodes glide towards the pointer and back instead of jumping.
    const lean = points.map(() => ({ x: 0, y: 0, near: 0 }));
    let coreNear = 0;
    let frame = 0;
    let visible = true;
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const t = now / 1000;
      const pointer = pointerRef.current;
      points.forEach(([x, y], i) => {
        const pull = pointerPull(pointer, x, y, 70);
        const state = lean[i]!;
        state.x = ease(state.x, pull.ux * pull.strength * 6);
        state.y = ease(state.y, pull.uy * pull.strength * 6);
        state.near = ease(state.near, pull.strength);
        const dx = Math.sin(t * 0.9 + i * 1.9) * 1.6 + Math.sin(t * 2.3 + i) * 0.5 + state.x;
        const dy = Math.cos(t * 0.8 + i * 2.4) * 1.6 + Math.sin(t * 2.9 + i) * 0.5 + state.y;
        const scale = 1 + state.near * 0.12;
        nodeRefs.current[i]?.setAttribute("transform", `translate(${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-x} ${-y})`);
        const link = linkRefs.current[i];
        link?.setAttribute("x2", (x + dx).toFixed(2));
        link?.setAttribute("y2", (y + dy).toFixed(2));
      });
      coreNear = ease(coreNear, pointerPull(pointer, c, c, 60).strength);
      const coreScale = 1 + Math.sin(t * 1.4) * 0.015 + coreNear * 0.1;
      coreRef.current?.setAttribute("transform", `translate(${c} ${c}) scale(${coreScale.toFixed(4)}) translate(${-c} ${-c})`);
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
    observer.observe(svg);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [positions, c]);

  return (
    <figure className={className}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-auto w-full max-w-[340px]"
        role="img"
        aria-label={t("label", { summary: summary || t("none") })}
        onPointerMove={(event) => {
          if (svgRef.current) pointerRef.current = svgPoint(event, svgRef.current, size, size);
        }}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
      >
        <circle cx={c} cy={c} r={radius} fill="none" stroke="var(--glass-line)" strokeDasharray="2 6" />
        {placed.map((node, index) => (
          <line
            key={`link-${node.id}`}
            ref={(el) => void (linkRefs.current[index] = el)}
            x1={c}
            y1={c}
            x2={node.x}
            y2={node.y}
            stroke={NODE_COLOR[node.state]}
            strokeOpacity={node.state === "idle" ? 0.25 : 0.55}
            strokeWidth={1.2}
            strokeDasharray={node.state === "working" ? "4 8" : undefined}
            style={node.state === "working" ? ({ "--travel": "-48px", animation: "consyrion-flow 1.4s linear infinite" } as CSSProperties) : undefined}
            data-state={node.state}
          />
        ))}
        <g ref={coreRef}>
          <circle cx={c} cy={c} r={30} fill="var(--surface)" stroke="var(--accent)" strokeOpacity={0.7} />
          <circle cx={c} cy={c} r={36} fill="none" stroke="var(--accent)" strokeOpacity={0.2} />
          <text x={c} y={c + 4} textAnchor="middle" fontSize={11} fill="var(--text)" fontWeight={600}>
            {centerLabel ?? t("center")}
          </text>
        </g>
        {placed.map((node, index) => (
          <g key={node.id} ref={(el) => void (nodeRefs.current[index] = el)} data-node-state={node.state}>
            {node.state === "working" ? (
              <circle
                cx={node.x}
                cy={node.y}
                r={23}
                fill="var(--primary)"
                opacity={0.14}
                style={{ transformOrigin: `${node.x}px ${node.y}px`, animation: "consyrion-pulse 1.6s ease-in-out infinite" }}
                data-pulse="true"
              />
            ) : null}
            <circle cx={node.x} cy={node.y} r={18} fill="var(--surface-2)" stroke={NODE_COLOR[node.state]} strokeWidth={1.6} />
            <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize={10} fill="var(--text)" fontWeight={600}>
              {node.label.slice(0, 3).toUpperCase()}
            </text>
            {node.sublabel ? (
              <text x={node.x} y={node.y + 32} textAnchor="middle" fontSize={9} fill="var(--muted)">
                {node.sublabel.length > 18 ? `${node.sublabel.slice(0, 17)}…` : node.sublabel}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {caption ? <figcaption className="mt-2 text-center text-xs text-muted">{caption}</figcaption> : null}
    </figure>
  );
}
