"use client";

import type { StrengthSuggestion, VoteWeightWarning } from "@consyrion/core/browser";
import { useFormatter, useTranslations } from "next-intl";
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

/**
 * The warning text in the interface language, built from the structured fields of the server's warning (#170);
 * `names` are the model names in row order (needed for the two-model wording).
 */
export function voteWarningText(t: ReturnType<typeof useTranslations>, w: VoteWeightWarning, names: ReadonlyArray<string>) {
  if (w.kind === "far_from_suggestion") return t("warning.far", { model: w.model, weight: w.weight, suggested: w.suggested });
  return names.length === 2
    ? t("warning.dominantTwo", { model: w.model, share: w.sharePercent, other: names[1 - w.index] ?? "" })
    : t("warning.dominant", { model: w.model, share: w.sharePercent });
}

function sourceLine(t: ReturnType<typeof useTranslations>, format: ReturnType<typeof useFormatter>, s: StrengthSuggestion | null) {
  if (!s || !s.source) return t("noRanking");
  const date = s.fetchedAt ? format.dateTime(new Date(s.fetchedAt), { day: "numeric", month: "short", year: "numeric" }) : "";
  return s.status === "unknown" ? t("notInRanking", { source: s.source, date }) : t("sourceModel", { source: s.source, model: s.sourceModel ?? "", date });
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
  const t = useTranslations("voteWeights");
  const format = useFormatter();
  const shares = weightShares(rows.map((r) => r.weight));
  const source = rows.find((r) => r.suggestion?.source)?.suggestion;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onSuggest}>
            {t("useSuggestion")}
          </Button>
          <Button variant="ghost" onClick={onEqual}>
            {t("equal")}
          </Button>
        </div>
      </div>
      <ul className="mt-4 space-y-3" aria-label={t("listLabel")}>
        {rows.map((row, index) => {
          const suggested = row.suggestion?.tier ?? 5;
          const adjusted = row.weight !== suggested;
          return (
            <li key={row.key} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_4.5rem] sm:items-center">
              <div className="min-w-0">
                <p className="font-medium break-words">{row.name}</p>
                <p className="text-xs text-muted">
                  {t.rich("suggestion", { value: suggested, strong: (chunks) => <strong className="text-text">{chunks}</strong> })} · {sourceLine(t, format, row.suggestion)}{" "}
                  {row.suggestion?.status === "stale" ? <Badge tone="warning">{t("stale")}</Badge> : null}
                  {row.suggestion?.status === "unknown" ? <Badge>{t("unknown")}</Badge> : null}
                  {adjusted ? <Badge tone="primary">{t("adjusted")}</Badge> : null}
                  {warnings.some((w) => w.index === index && w.kind === "dominant_share") ? <Badge tone="warning">{t("dominant")}</Badge> : null}
                  {warnings.some((w) => w.index === index && w.kind === "far_from_suggestion") ? <Badge tone="warning">{t("far")}</Badge> : null}
                </p>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <span className="sr-only">{t("weightOf", { name: row.name })}</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={row.weight}
                  onChange={(e) => onChange(row.key, Number(e.target.value))}
                  className="w-full accent-[var(--primary)]"
                  aria-valuetext={t("valueText", { weight: row.weight, share: shares[index] ?? 0 })}
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
                <li key={`${w.kind}-${w.index}`}>{voteWarningText(t, w, rows.map((r) => r.name))}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
      {source?.sourceUrl ? (
        <p className="mt-3 text-xs text-muted">
          {t.rich("sourceNote", {
            source: source.source ?? "",
            link: (chunks) => (
              <a className="underline" href={source.sourceUrl!} target="_blank" rel="noreferrer">
                {chunks}
              </a>
            ),
          })}
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
