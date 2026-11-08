"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { modelName, type View } from "./helpers";
import type { EdgeKind, ReplayEdge, ReplayEvent } from "./replay-events";

const EDGE_COLOR: Record<EdgeKind, string> = {
  question: "var(--primary)",
  critique: "var(--warning)",
  answer: "var(--success)",
  objection: "var(--danger)",
};
/** Dashes as a second channel next to colour (colour blindness). */
const EDGE_DASH: Record<EdgeKind, string | undefined> = { question: "6 4", critique: undefined, answer: "2 4", objection: "10 3 2 3" };

/**
 * Network view of the replay (#271 part 3): models on the left, proposals on the right, one line per kind of stored
 * contact up to the cursor (width = number of rows). No animation, no inferred lines. Every line is also a button in
 * the list below, so keyboard and screen-reader users reach the same original texts.
 */
export function ReplayNetwork({
  view,
  edges,
  events,
  summary,
  details,
}: {
  view: View;
  edges: ReplayEdge[];
  events: ReplayEvent[];
  summary: (e: ReplayEvent) => string;
  details: (e: ReplayEvent) => ReactNode;
}) {
  const t = useTranslations("replay");
  const [selected, setSelected] = useState<string | null>(null);
  const models = view.participants;
  const proposals = view.proposals;
  if (!edges.length) return <p className="mt-3 text-sm text-muted">{t("network.empty")}</p>;

  const width = 640;
  const rowH = 56;
  const height = Math.max(models.length, proposals.length, 2) * rowH + 24;
  const y = (index: number, count: number) => 12 + (height - 24) * ((index + 0.5) / Math.max(count, 1));
  const left = 150;
  const right = width - 150;
  const byId = new Map(events.map((e) => [e.id, e]));
  const current = edges.find((e) => e.key === selected) ?? null;
  const kindsUsed = [...new Set(edges.map((e) => e.kind))];

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t("network.aria", { edges: edges.length })}>
        {edges.map((edge) => {
          const from = models.findIndex((m) => m.id === edge.participantId);
          const to = proposals.findIndex((p) => p.id === edge.proposalId);
          if (from < 0 || to < 0) return null;
          // Parallel kinds between the same pair are offset a little so they stay distinguishable.
          const offset = (["question", "critique", "answer", "objection"].indexOf(edge.kind) - 1.5) * 4;
          const strokeWidth = Math.min(1.5 + Math.log2(edge.eventIds.length + 1) * 1.5, 8);
          const isSelected = edge.key === selected;
          return (
            <g key={edge.key} onClick={() => setSelected(isSelected ? null : edge.key)} className="cursor-pointer">
              <line x1={left} y1={y(from, models.length) + offset} x2={right} y2={y(to, proposals.length) + offset} stroke="transparent" strokeWidth={14} />
              <line
                x1={left}
                y1={y(from, models.length) + offset}
                x2={right}
                y2={y(to, proposals.length) + offset}
                stroke={EDGE_COLOR[edge.kind]}
                strokeWidth={strokeWidth}
                strokeDasharray={EDGE_DASH[edge.kind]}
                strokeOpacity={selected && !isSelected ? 0.25 : 0.85}
              />
            </g>
          );
        })}
        {models.map((m, i) => (
          <g key={m.id}>
            <circle cx={left} cy={y(i, models.length)} r={8} fill={m.status === "failed" ? "var(--danger)" : "var(--surface-2)"} stroke="var(--glass-line)" />
            <text x={left - 14} y={y(i, models.length) + 4} textAnchor="end" fontSize={12} fill="var(--text)">
              {/* The model id alone (the provider prefix made three Claude models look the same); full name as tooltip. */}
              <title>{modelName(view, m.id)}</title>
              {truncate(m.modelId, 22)}
            </text>
          </g>
        ))}
        {proposals.map((p, i) => (
          <g key={p.id}>
            <rect x={right - 9} y={y(i, proposals.length) - 9} width={18} height={18} rx={4} fill="var(--surface-2)" stroke="var(--glass-line)" />
            <text x={right + 16} y={y(i, proposals.length) + 4} fontSize={12} fill="var(--text)">
              {t("network.proposal", { label: p.label ?? "?" })}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-3 text-xs text-muted" aria-label={t("network.legend")}>
        {kindsUsed.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <svg width="24" height="6" aria-hidden>
              <line x1="0" y1="3" x2="24" y2="3" stroke={EDGE_COLOR[kind]} strokeWidth="2.5" strokeDasharray={EDGE_DASH[kind]} />
            </svg>
            {t(`network.kind.${kind}`)}
          </li>
        ))}
      </ul>

      <h4 className="mt-4 text-sm font-medium">{t("network.connections")}</h4>
      <ul className="mt-2 space-y-1 text-sm">
        {edges.map((edge) => (
          <li key={edge.key}>
            <button
              type="button"
              aria-pressed={edge.key === selected}
              onClick={() => setSelected(edge.key === selected ? null : edge.key)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-muted hover:bg-surface-2 aria-pressed:bg-primary/10 aria-pressed:text-text"
            >
              {t("network.edge", {
                model: modelName(view, edge.participantId),
                kind: t(`network.kind.${edge.kind}`),
                label: proposals.find((p) => p.id === edge.proposalId)?.label ?? "?",
                count: edge.eventIds.length,
              })}
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
          {current.eventIds.map((id) => {
            const event = byId.get(id);
            if (!event) return null;
            return (
              <div key={id}>
                <p className="text-xs text-muted">{summary(event)}</p>
                <div className="mt-1">{details(event)}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Keeps the start and the distinguishing end ("claude-…-model-3"). */
const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, Math.ceil(max / 2) - 1)}…${value.slice(-Math.floor(max / 2))}` : value;
