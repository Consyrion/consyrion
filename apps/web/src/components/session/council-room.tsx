"use client";

import type { CouncilPhase } from "@consyrion/core/browser";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MarkShapes } from "../brand/consyrion-logo";
import { PROVIDER_COLOR } from "../dashboard/activity-network-data";
import { CompactNetwork } from "../dashboard/live-council-compact";
import { ease, pointerPull, svgPoint } from "../dashboard/pointer-field";
import { buttonClasses } from "../ui/button";
import { GlassPanel } from "../ui/glass";
import { Badge } from "../ui/surface";
import { contentOf, modelName, PROVIDER_LABELS, proposalLabel, roleLabel, SEVERITY_TONE, STATUS_TONE, type View } from "./helpers";
import { Select } from "../ui/select";

type VoiceState = "working" | "submitted" | "waiting" | "failed" | "evaluation_failed" | "roles_failed";

const VOICE_TEXT: Record<VoiceState, string> = {
  working: "Working",
  submitted: "Submitted",
  waiting: "Waiting",
  failed: "Failed",
  evaluation_failed: "No evaluation",
  roles_failed: "Roles failed",
};
const VOICE_TONE: Record<VoiceState, "primary" | "success" | "neutral" | "danger" | "warning"> = {
  working: "primary",
  submitted: "success",
  waiting: "neutral",
  failed: "danger",
  evaluation_failed: "warning",
  roles_failed: "warning",
};

/**
 * 12 Minds Council progress of one model in the newest round (#175): reviewed, failed and still open roles. A model
 * is only "Submitted" when every one of its role reviews is in.
 */
function roleProgress(view: View, participantId: string) {
  const roles = view.roles.filter((r) => r.participantId === participantId);
  const settled = view.messages.filter((m) => m.phase === "twelve_minds_council" && (m.kind === "preference" || m.kind === "role_failed"));
  const round = Math.max(1, ...settled.map((m) => m.round));
  const mine = settled.filter((m) => m.round === round && m.participantId === participantId);
  const reviewed = roles.filter((r) => mine.some((m) => m.role === r.role && m.kind === "preference")).length;
  const failed = roles.filter((r) => mine.some((m) => m.role === r.role && m.kind === "role_failed")).length;
  return { roles: roles.length, reviewed, failed, open: roles.length - reviewed - failed };
}

/** Failed calls of a model and the kind of the last failure, e.g. "8 failed calls · last: overloaded (HTTP 503)" (#175). */
export function failureSummary(view: View, participantId: string): string | null {
  const f = view.callFailures.find((x) => x.participantId === participantId);
  if (!f) return null;
  const kind = f.lastErrorKind.replaceAll("_", " ");
  return `${f.failed} failed call${f.failed === 1 ? "" : "s"} · last: ${kind}${f.lastHttpStatus ? ` (HTTP ${f.lastHttpStatus})` : ""}`;
}
const LIVE = new Set(["queued", "running", "cancel_requested"]);

/**
 * Progress of a running Minority Review (#184), e.g. "34 of 87 objections decided": judges answer in batches and each
 * objection is stored as decided as soon as its judges answered. Null outside a running Minority Review.
 */
export function objectionProgress(view: View): string | null {
  if (view.session.currentPhase !== "minority_review" || !LIVE.has(view.session.status) || view.objections.length === 0) return null;
  const decided = view.objections.filter((o) => o.status !== "open").length;
  return `${decided} of ${view.objections.length} objection${view.objections.length === 1 ? "" : "s"} decided`;
}

/** State of each model in the current phase, from stored usage rows – the same source as the phase screens (#69). */
export function voiceStates(view: View): Record<string, VoiceState> {
  const phase = view.session.currentPhase as CouncilPhase | null;
  const live = LIVE.has(view.session.status);
  return Object.fromEntries(
    view.participants.map((p) => {
      if (p.status === "failed") return [p.id, "failed"];
      const answered = view.usage.some((u) => u.participantId === p.id && u.phase === phase && u.outcome === "ok");
      // Queued: no request is in flight yet (#106). Ended without a verdict: unanswered models did not finish.
      if (view.session.status === "queued") return [p.id, "waiting"];
      if (view.session.status === "failed" || view.session.status === "cancelled") return [p.id, answered ? "submitted" : "waiting"];
      // After the verdict the last phase is the evaluation: a model without a stored vote did not evaluate (#151).
      if (!live && view.decision && !view.votes.some((v) => v.evaluatorParticipantId === p.id)) return [p.id, "evaluation_failed"];
      // 12 Minds Council: one answered role is not the model's whole review (#175).
      if (live && phase === "twelve_minds_council") {
        const progress = roleProgress(view, p.id);
        if (progress.roles > 0 && progress.open > 0) return [p.id, "working"];
        if (progress.failed > 0) return [p.id, "roles_failed"];
      }
      return [p.id, live ? (answered ? "submitted" : "working") : "submitted"];
    }),
  );
}

const NODE_STATE = { working: "working", submitted: "done", waiting: "idle", failed: "failed", evaluation_failed: "failed", roles_failed: "failed" } as const;

/** Chip width for a role label at 12 px (approximation; long labels are shortened, the full text is in <title>). */
function chip(label: string) {
  const text = label.length > 30 ? `${label.slice(0, 29)}…` : label;
  return { text, width: 34 + text.length * 7.6 };
}

/**
 * Independent voices (design concept 2, #79/#80): the original mark in a lit core, one lit node per model – the
 * only independent votes – with a worded status chip, and the 12 Minds perspectives each model plays as connected
 * role chips. Every model floats gently in place and leans towards a nearby mouse pointer, growing and glowing
 * brighter under it; the core does the same. Reduced motion keeps the static graphic. Small screens get the
 * compact graphic and model cards with expandable roles; the SVG is decorative, the text lives in the list.
 */
function VoicesNetwork({ view, states }: { view: View; states: Record<string, VoiceState> }) {
  const W = 900;
  const H = 440;
  const cx = 450;
  const cy = 212;
  const ring = 150;
  const n = view.participants.length;
  // With an even number of models no node sits straight below the core: its role chips covered the status label of
  // the neighbouring node (#151, six models at 1440 px).
  const offset = n % 2 === 0 ? Math.PI / Math.max(n, 1) : 0;
  const placed = view.participants.map((p, i) => {
    const angle = -Math.PI / 2 + offset + (i / Math.max(n, 1)) * Math.PI * 2;
    return { ...p, x: cx + ring * 1.08 * Math.cos(angle), y: cy + ring * Math.sin(angle) };
  });
  const maxChips = n > 4 ? 2 : 4;
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const coreRef = useRef<SVGGElement>(null);
  const coreGlowRef = useRef<SVGCircleElement>(null);
  const nodeRefs = useRef<Array<SVGGElement | null>>([]);
  const glowRefs = useRef<Array<SVGCircleElement | null>>([]);
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
        const pull = pointerPull(pointer, x, y, 180);
        const state = lean[i]!;
        state.x = ease(state.x, pull.ux * pull.strength * 12);
        state.y = ease(state.y, pull.uy * pull.strength * 12);
        state.near = ease(state.near, pull.strength);
        const dx = Math.sin(t * 0.9 + i * 1.9) * 2.6 + Math.sin(t * 2.3 + i) * 0.8 + state.x;
        const dy = Math.cos(t * 0.8 + i * 2.4) * 2.6 + Math.sin(t * 2.9 + i) * 0.8 + state.y;
        const scale = 1 + state.near * 0.07;
        nodeRefs.current[i]?.setAttribute(
          "transform",
          `translate(${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-x} ${-y})`,
        );
        glowRefs.current[i]?.setAttribute("opacity", (0.32 + state.near * 0.4).toFixed(2));
      });
      coreNear = ease(coreNear, pointerPull(pointer, cx, cy, 130).strength);
      const coreScale = 1 + Math.sin(t * 1.4) * 0.01 + coreNear * 0.06;
      coreRef.current?.setAttribute("transform", `translate(${cx} ${cy}) scale(${coreScale.toFixed(4)}) translate(${-cx} ${-cy})`);
      coreGlowRef.current?.setAttribute("opacity", (0.28 + Math.sin(t * 1.4) * 0.06 + coreNear * 0.35).toFixed(2));
      frame = requestAnimationFrame(tick);
    };
    const resume = () => {
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(tick);
    };
    // Only animate while the graphic is on screen (it is hidden on small screens) and the tab is visible.
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
  }, [positions]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-end gap-3 text-xs text-muted" aria-hidden="true">
        {(["working", "submitted", "waiting"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${s === "working" ? "bg-primary" : s === "submitted" ? "bg-success" : "bg-accent"}`} />
            {VOICE_TEXT[s]}
          </span>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto hidden h-auto w-full max-w-[880px] sm:block"
        aria-hidden="true"
        focusable="false"
        onPointerMove={(event) => {
          if (svgRef.current) pointerRef.current = svgPoint(event, svgRef.current, W, H);
        }}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
      >
        <defs>
          <radialGradient id="vn-core" cx="0.45" cy="0.38" r="0.7">
            <stop offset="0" stopColor="#1b3d6e" />
            <stop offset="1" stopColor="#060d1d" />
          </radialGradient>
          <linearGradient id="vn-mark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="0.55" stopColor="#2ee6a8" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="vn-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <marker id="vn-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#9fc4ff" fillOpacity="0.7" />
          </marker>
          {placed.map((p, i) => (
            <radialGradient key={p.id} id={`vn-node-${i}`} cx="0.4" cy="0.35" r="0.75">
              <stop offset="0" stopColor={PROVIDER_COLOR[p.provider] ?? "#22d3ee"} stopOpacity="0.55" />
              <stop offset="0.65" stopColor="#0a1530" />
              <stop offset="1" stopColor="#050b19" />
            </radialGradient>
          ))}
        </defs>
        <circle cx={cx} cy={cy} r={ring + 62} fill="none" stroke="#9fc4ff" strokeOpacity="0.12" strokeDasharray="2 7" />
        <circle cx={cx} cy={cy} r={ring + 30} fill="none" stroke="#9fc4ff" strokeOpacity="0.1" />
        {/* Arcs between neighbouring models: they question each other. */}
        {n > 1
          ? placed.map((p, i) => {
              const q = placed[(i + 1) % n]!;
              if (n === 2 && i === 1) return null;
              const mx = (p.x + q.x) / 2;
              const my = (p.y + q.y) / 2;
              const ox = (mx - cx) * 0.35;
              const oy = (my - cy) * 0.35;
              const color = PROVIDER_COLOR[p.provider] ?? "#22d3ee";
              return (
                <path
                  key={`arc-${p.id}`}
                  d={`M${p.x} ${p.y} Q ${mx + ox} ${my + oy} ${q.x} ${q.y}`}
                  fill="none"
                  stroke={color}
                  strokeOpacity="0.55"
                  strokeWidth="2"
                  markerEnd="url(#vn-arrow)"
                  pathLength={100}
                  strokeDasharray="30 40 30"
                />
              );
            })
          : null}
        {placed.map((p) => {
          const color = PROVIDER_COLOR[p.provider] ?? "#22d3ee";
          const working = states[p.id] === "working";
          return (
            <g key={`spoke-${p.id}`}>
              <line x1={p.x} y1={p.y} x2={cx} y2={cy} stroke={color} strokeOpacity="0.18" strokeWidth="9" />
              <line
                x1={p.x}
                y1={p.y}
                x2={cx}
                y2={cy}
                stroke={color}
                strokeOpacity={working ? 0.95 : 0.55}
                strokeWidth="1.8"
                strokeDasharray={working ? "6 9" : undefined}
                style={working ? ({ "--travel": "-60px", animation: "consyrion-flow 1.3s linear infinite" } as CSSProperties) : undefined}
              />
            </g>
          );
        })}
        <g ref={coreRef}>
          <circle ref={coreGlowRef} cx={cx} cy={cy} r="70" fill="#22d3ee" opacity="0.28" filter="url(#vn-glow)" />
          <circle cx={cx} cy={cy} r="62" fill="url(#vn-core)" stroke="#22d3ee" strokeWidth="2.2" />
          <circle cx={cx} cy={cy} r="54" fill="none" stroke="#9fc4ff" strokeOpacity="0.15" />
          <g transform={`translate(${cx - 25.6} ${cy - 48}) scale(0.8)`} fill="none">
            <MarkShapes stroke="url(#vn-mark)" />
          </g>
          <text x={cx} y={cy + 32} textAnchor="middle" fontSize="18" fontWeight="700" fill="#e8eefc">
            Decision
          </text>
        </g>
        {placed.map((p, i) => {
          const color =
            p.status === "failed"
              ? "var(--danger)"
              : states[p.id] === "evaluation_failed" || states[p.id] === "roles_failed"
                ? "var(--warning)"
                : (PROVIDER_COLOR[p.provider] ?? "#22d3ee");
          const failures = failureSummary(view, p.id);
          const roles = view.roles.filter((r) => r.participantId === p.id).map((r) => roleLabel(r.role));
          const shown = roles.slice(0, maxChips);
          const extra = roles.length - shown.length;
          const toLeft = p.x <= cx + 1;
          const state = states[p.id] ?? "waiting";
          const stack = shown.length + (extra > 0 ? 1 : 0);
          const top = p.y - (stack * 34 - 6) / 2;
          return (
            <g key={p.id} ref={(el) => void (nodeRefs.current[i] = el)} data-node-state={state}>
              {/* Role chips, connected to their model. */}
              {[...shown.map((r) => chip(r)), ...(extra > 0 ? [chip(`+${extra} more`)] : [])].map((c, k) => {
                const y = top + k * 34;
                const x = toLeft ? p.x - 70 - c.width : p.x + 70;
                const anchorX = toLeft ? x + c.width : x;
                return (
                  <g key={`${c.text}-${k}`}>
                    <title>{shown[k] ?? `${extra} more perspectives`}</title>
                    <path d={`M${anchorX} ${y + 14} L${toLeft ? p.x - 50 : p.x + 50} ${p.y}`} stroke={color} strokeOpacity="0.4" fill="none" />
                    <rect x={x} y={y} width={c.width} height="28" rx="14" fill="#081226" fillOpacity="0.92" stroke={color} strokeOpacity="0.55" />
                    <text x={x + 14} y={y + 19} fontSize="14" fill="#dbe4f5">
                      {c.text}
                    </text>
                    <circle cx={x + c.width - 14} cy={y + 14} r="4.5" fill={color} />
                  </g>
                );
              })}
              {state === "working" ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="58"
                  fill={color}
                  opacity="0.16"
                  style={{ transformOrigin: `${p.x}px ${p.y}px`, animation: "consyrion-pulse 1.8s ease-in-out infinite" }}
                />
              ) : null}
              <circle ref={(el) => void (glowRefs.current[i] = el)} cx={p.x} cy={p.y} r="50" fill={color} opacity="0.32" filter="url(#vn-glow)" />
              <circle cx={p.x} cy={p.y} r="46" fill={`url(#vn-node-${i})`} stroke={color} strokeWidth="2.6" />
              <circle cx={p.x} cy={p.y} r="39" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
              <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="#ffffff">
                {PROVIDER_LABELS[p.provider] ?? p.provider}
              </text>
              {/* Status in words, not only colour. */}
              <rect x={p.x - 56} y={p.y + 54} width="112" height="26" rx="13" fill="#081226" stroke={color} strokeOpacity="0.7" />
              <text x={p.x} y={p.y + 71.5} textAnchor="middle" fontSize="13.5" fill="#e8eefc">
                {VOICE_TEXT[state]}
              </text>
              {failures ? (
                <text x={p.x} y={p.y + 96} textAnchor="middle" fontSize="12" fill="var(--warning)">
                  <title>{failures}</title>
                  {failures.length > 44 ? `${failures.slice(0, 43)}…` : failures}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <CompactNetwork
        className="sm:hidden"
        nodes={view.participants.map((p) => ({ id: p.id, provider: p.provider, model: p.modelId, state: NODE_STATE[states[p.id] ?? "waiting"] }))}
      />
      {/* Text version: visible model cards on small screens, screen-reader list on larger ones. */}
      <ul className="mt-3 space-y-2 sm:sr-only" aria-label="Models and their perspectives">
        {view.participants.map((p, i) => {
          const state = states[p.id] ?? "waiting";
          const roles = view.roles.filter((r) => r.participantId === p.id).map((r) => roleLabel(r.role));
          return (
            <li key={p.id} className="rounded-xl border border-glass-line bg-surface/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="grid size-6 place-items-center rounded-full border-2 text-xs font-bold"
                  style={{ borderColor: PROVIDER_COLOR[p.provider] }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1 font-medium break-words">{modelName(view, p.id)}</span>
                <Badge tone={VOICE_TONE[state]}>{VOICE_TEXT[state]}</Badge>
              </div>
              {failureSummary(view, p.id) ? <p className="mt-1 text-xs text-warning">{failureSummary(view, p.id)}</p> : null}
              {roles.length ? (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted">{roles.length} perspectives</summary>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {roles.map((role) => (
                      <li
                        key={role}
                        className="rounded-full border px-2.5 py-0.5 text-xs"
                        style={{ borderColor: `color-mix(in oklab, ${PROVIDER_COLOR[p.provider] ?? "#22d3ee"} 55%, transparent)` }}
                      >
                        {role}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Objections({ view }: { view: View }) {
  const [category, setCategory] = useState("all");
  const categories = [...new Set(view.objections.map((o) => o.category))];
  const order = { open: 0, accepted: 1, unresolved: 2, resolved: 3, refuted: 4 } as Record<string, number>;
  const list = view.objections
    .filter((o) => category === "all" || o.category === category)
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const progress = objectionProgress(view);
  return (
    <GlassPanel className="p-5" aria-label="Objections and evidence">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Objections &amp; evidence</h2>
        {progress ? (
          <p className="text-sm text-muted" role="status">
            {progress}
          </p>
        ) : null}
        {categories.length > 1 ? (
          <label className="text-sm">
            <span className="sr-only">Filter objections by topic</span>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="min-w-40">
              <option value="all">All topics</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted">
          {view.session.currentPhase && ["independent_thinking", "open_council", "twelve_minds_council"].includes(view.session.currentPhase)
            ? "Objections appear after the 12 Minds Council."
            : "No objections were raised."}
        </p>
      ) : (
        <ul className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 lg:max-[1599px]:grid-cols-2">
          {list.map((o) => (
            <li key={o.id} className={`glass-quiet rounded-xl p-4 ${o.blocking ? "border-danger/60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">
                  Proposal {proposalLabel(view, o.proposalId)}: {o.claim}
                </p>
                <span className="flex gap-1.5">
                  <Badge tone={SEVERITY_TONE[o.severity as keyof typeof SEVERITY_TONE] ?? "neutral"}>{o.severity}</Badge>
                  <Badge tone={STATUS_TONE[o.status as keyof typeof STATUS_TONE] ?? "neutral"}>{o.status}</Badge>
                  {o.blocking ? <Badge tone="danger">blocking</Badge> : null}
                  {o.undefendedReason && !o.response ? <Badge tone="warning">not defended</Badge> : null}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  <span className="text-muted">Raised by</span> {modelName(view, o.raisedByParticipantId)}
                  {o.evidence ? <span className="block pl-3 text-xs text-muted">Evidence: {o.evidence}</span> : null}
                </li>
                {o.response ? (
                  <li>
                    <span className="text-muted">Author:</span> {o.response}
                  </li>
                ) : o.undefendedReason ? (
                  // The author's model failed (#175): unanswered, not uncontested.
                  <li className="text-warning">Not defended – {o.undefendedReason}. The author could not answer; this is not uncontested criticism.</li>
                ) : null}
                {o.resolutionReason ? (
                  <li>
                    <span className="text-muted">
                      {o.reviewedByParticipantId ? `Independent review (${modelName(view, o.reviewedByParticipantId)}):` : "Independent review:"}
                    </span>{" "}
                    {o.resolutionReason.length > 320 ? (
                      // Long notes of earlier runs stay readable: the start, the rest on request.
                      <details className="inline">
                        <summary className="inline cursor-pointer">{o.resolutionReason.slice(0, 280)}… more</summary>
                        {o.resolutionReason.slice(280)}
                      </details>
                    ) : (
                      o.resolutionReason
                    )}
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function Proposals({ view, onOpen }: { view: View; onOpen: (tab: "open_council" | "evaluation") => void }) {
  const matrix = view.decision?.matrix as { proposals?: Array<{ proposalId: string; total: number | null; independentEvaluators?: number }> } | undefined;
  const recommended = view.decision?.recommendedProposalId;
  return (
    <GlassPanel className="p-5" aria-label="Proposals from the council">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Proposals from the council</h2>
        {view.proposals.length > 1 ? (
          <button type="button" onClick={() => onOpen("open_council")} className="text-sm text-primary hover:underline">
            View comparison
          </button>
        ) : null}
      </div>
      {!view.decision && view.proposals.length > 0 && (view.session.status === "failed" || view.session.status === "cancelled") ? (
        <p className="mb-3 text-sm text-warning">Incomplete council: these proposals were not debated, evaluated or approved. They are no verdict.</p>
      ) : null}
      {view.proposals.length === 0 ? (
        <p className="text-sm text-muted">
          {view.session.status === "failed" || view.session.status === "cancelled"
            ? `${view.submittedCount} of ${view.participants.length} proposals submitted – the council ended before they were revealed.`
            : `${view.submittedCount} of ${view.participants.length} proposals submitted – contents stay hidden until every model has finished.`}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {view.proposals.map((p) => {
            const content = contentOf(p);
            const scored = matrix?.proposals?.find((m) => m.proposalId === p.id);
            const total = scored?.total;
            const evaluators = scored?.independentEvaluators;
            return (
              <li key={p.id} className={`glass-quiet rounded-xl p-4 ${p.id === recommended ? "neon-ring" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary">{p.label}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{content.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{content.summary}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{p.revisions.length > 1 ? `revised ${p.revisions.length - 1}×` : "original"}</span>
                  {p.architectureChange?.changed ? (
                    <Badge tone="warning">architecture changed</Badge>
                  ) : null}
                  <span>·</span>
                  {total != null ? (
                    <button type="button" onClick={() => onOpen("evaluation")} className="text-text hover:underline">
                      score {total} / 10
                      {evaluators != null ? ` · ${evaluators} evaluation${evaluators === 1 ? "" : "s"}` : ""}
                    </button>
                  ) : (
                    <span>not yet evaluated</span>
                  )}
                  {p.id === recommended ? <Badge tone="success">recommended</Badge> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}

/** Council Room overview (design concept 2): voices, objections, proposals and the human gate on one screen. */
export function CouncilRoom({ view, onOpen }: { view: View; onOpen: (tab: "open_council" | "evaluation" | "final_verdict") => void }) {
  const states = voiceStates(view);
  const awaiting = view.session.status === "awaiting_approval";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 min-[1600px]:grid-cols-[minmax(0,1.75fr)_minmax(360px,1fr)]">
        <GlassPanel
          className="flex min-w-0 flex-col border-[#22d3ee]/35 p-5 shadow-[0_0_40px_-18px_rgb(34_211_238/0.55)]"
          glow={LIVE.has(view.session.status) ? "cyan" : "none"}
          aria-label="Independent voices"
        >
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">Independent voices</h2>
          <p className="text-sm text-muted">
            {view.participants.length} models · {view.roles.length} perspectives – each model is one independent vote; perspectives are roles, not extra votes.
          </p>
          <div className="flex flex-1 flex-col justify-center">
            <VoicesNetwork view={view} states={states} />
          </div>
        </GlassPanel>
        <Objections view={view} />
      </div>
      <Proposals view={view} onOpen={onOpen} />
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 ${awaiting ? "border-warning/60 bg-warning/10" : "border-glass-line bg-surface/50"}`}
      >
        <p className="text-sm">
          <strong className={awaiting ? "text-warning" : ""}>{awaiting ? "Your decision is needed." : "You decide."}</strong>{" "}
          <span className="text-muted">
            {awaiting
              ? "The verdict is ready – approve, choose an alternative, ask for more debate or reject. Then send it where you work; building it is optional and needs a GitHub repository."
              : view.session.status === "approved"
                ? "Approved – send the decision, or with a connected repository start the optional Execution Council."
                : view.session.status === "failed" || view.session.status === "cancelled"
                  ? "The council ended without a verdict – nothing can be approved or built from it."
                  : "Debate in progress; final approval follows the verdict."}
          </span>
        </p>
        {view.decision ? (
          <button type="button" onClick={() => onOpen("final_verdict")} className={buttonClasses(awaiting ? "primary" : "secondary")}>
            {awaiting ? "Review verdict" : "View verdict"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
