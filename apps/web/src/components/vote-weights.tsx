"use client";

import type { StrengthSuggestion, VoteWeightWarning } from "@consyrion/core/browser";
import { useState } from "react";
import { Button } from "./ui/button";
import { Alert, Badge, Card } from "./ui/surface";

export interface VoteWeightRow {
  key: string;
  name: string;
  weight: number;
  /** Catalog suggestion (#139); null while the model list has none. */
  suggestion: StrengthSuggestion | null;
}

/**
 * Whole-percent shares of the total vote (#141) that always add up to 100: largest remainder, ties by position.
 */
export function weightShares(weights: ReadonlyArray<number>): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * 100);
  const shares = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  const missing = 100 - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < missing; i++) shares[order[i % order.length]!.index]! += 1;
  return shares;
}

function sourceLine(s: StrengthSuggestion | null) {
  if (!s || !s.source) return "No ranking loaded yet – neutral 5";
  const date = s.fetchedAt ? new Date(s.fetchedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  return s.status === "unknown" ? `Not in ${s.source} (${date}) – neutral 5` : `${s.source}: ${s.sourceModel} (${date})`;
}

/**
 * Vote weights before the run (#141): the suggestion per model with its source, a 1–10 control, the share of the
 * total vote and a bar. The weights are fixed when the council starts (#140).
 */
export function VoteWeights({
  rows,
  onChange,
  onSuggest,
  onEqual,
  warnings,
}: {
  rows: VoteWeightRow[];
  /** Pre-start warnings (#170), computed by the server preview (#189): the rule stays out of the browser. */
  warnings: ReadonlyArray<VoteWeightWarning>;
  onChange: (key: string, weight: number) => void;
  onSuggest: () => void;
  onEqual: () => void;
}) {
  const shares = weightShares(rows.map((r) => r.weight));
  const source = rows.find((r) => r.suggestion?.source)?.suggestion;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Vote weights</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            How much each model&apos;s scores and ranking count in the Final Verdict. Its own proposal is never weighted, and the feasibility check counts every
            model once. Fixed when the council starts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onSuggest}>
            Use AI suggestion
          </Button>
          <Button variant="ghost" onClick={onEqual}>
            All equal
          </Button>
        </div>
      </div>
      <ul className="mt-4 space-y-3" aria-label="Vote weight per model">
        {rows.map((row, index) => {
          const suggested = row.suggestion?.tier ?? 5;
          const adjusted = row.weight !== suggested;
          return (
            <li key={row.key} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4.5rem] sm:items-center">
              <div className="min-w-0">
                <p className="font-medium break-words">{row.name}</p>
                <p className="text-xs text-muted">
                  AI suggestion <strong className="text-text">{suggested}/10</strong> · {sourceLine(row.suggestion)}{" "}
                  {row.suggestion?.status === "stale" ? <Badge tone="warning">ranking older than 7 days</Badge> : null}
                  {row.suggestion?.status === "unknown" ? <Badge>unknown</Badge> : null}
                  {adjusted ? <Badge tone="primary">adjusted</Badge> : null}
                  {warnings.some((w) => w.index === index && w.kind === "dominant_share") ? <Badge tone="warning">dominant vote share</Badge> : null}
                  {warnings.some((w) => w.index === index && w.kind === "far_from_suggestion") ? <Badge tone="warning">far from suggestion</Badge> : null}
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <span className="sr-only">Vote weight of {row.name}</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={row.weight}
                  onChange={(e) => onChange(row.key, Number(e.target.value))}
                  className="w-full accent-[var(--primary)]"
                  aria-valuetext={`${row.weight} of 10, ${shares[index]} percent of the vote`}
                />
                <span className="w-10 text-right font-semibold tabular-nums">{row.weight}/10</span>
              </label>
              <div className="flex items-center gap-2 sm:block">
                <span className="text-sm tabular-nums">{shares[index]} %</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 sm:mt-1" aria-hidden="true">
                  <div className="h-full bg-primary" style={{ width: `${shares[index]}%` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {warnings.length ? (
        <div className="mt-3">
          <Alert tone="warning">
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((w) => (
                <li key={`${w.kind}-${w.index}`}>{w.message}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
      {source?.sourceUrl ? (
        <p className="mt-3 text-xs text-muted">
          Suggestions from the{" "}
          <a className="underline" href={source.sourceUrl} target="_blank" rel="noreferrer">
            {source.source}
          </a>{" "}
          (percentile tier 1–10). A model that is not in the ranking gets the neutral 5.
        </p>
      ) : null}
    </Card>
  );
}

/** Gallery fixture (#141): labelled demo data, never real rankings. */
export function VoteWeightsDemo() {
  const suggestion = (tier: number, status: StrengthSuggestion["status"], sourceModel: string | null): StrengthSuggestion => ({
    tier,
    status,
    sourceModel,
    rawScore: null,
    source: "Demo ranking",
    sourceUrl: null,
    fetchedAt: "2026-10-27T00:00:00.000Z",
  });
  const [rows, setRows] = useState<VoteWeightRow[]>([
    { key: "a", name: "demo-model-a", weight: 10, suggestion: suggestion(10, "known", "Demo Model A") },
    { key: "b", name: "demo-model-b", weight: 6, suggestion: suggestion(8, "known", "Demo Model B") },
    { key: "c", name: "demo-model-c", weight: 4, suggestion: suggestion(4, "stale", "Demo Model C") },
    { key: "d", name: "demo-model-d", weight: 5, suggestion: suggestion(5, "unknown", null) },
  ]);
  return (
    <VoteWeights
      rows={rows}
      onChange={(key, weight) => setRows((current) => current.map((r) => (r.key === key ? { ...r, weight } : r)))}
      onSuggest={() => setRows((current) => current.map((r) => ({ ...r, weight: r.suggestion?.tier ?? 5 })))}
      onEqual={() => setRows((current) => current.map((r) => ({ ...r, weight: 5 })))}
      // The gallery has no server preview; warnings are shown in the real setup only (#189).
      warnings={[]}
    />
  );
}
