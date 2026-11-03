import type { ReactNode } from "react";
import { GlassPanel } from "../ui/glass";
import { Badge } from "../ui/surface";

type Tone = "cyan" | "emerald" | "violet" | "magenta";

const STROKE: Record<Tone, string> = { cyan: "var(--primary)", emerald: "var(--success)", violet: "var(--accent)", magenta: "var(--magenta)" };

/** Minimal sparkline: thin glowing stroke with a soft fill. Values are plotted as given – nothing is invented. */
export function Sparkline({ values, tone = "cyan", label }: { values: number[]; tone?: Tone; label: string }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 36;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={STROKE[tone]} opacity={0.12} />
      <polyline points={points.join(" ")} fill="none" stroke={STROKE[tone]} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface LiveMetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** Real series behind the value (e.g. tokens of the last sessions). */
  series?: { values: number[]; label: string };
  /** Shows the pulsing "live" dot – only for values that are actually updating right now. */
  live?: boolean;
  /** Marks fixture data in the component gallery so it is never mistaken for real numbers. */
  demo?: boolean;
  footer?: ReactNode;
}

/** Metric card for the dashboard. Every number shown must come from the workspace or be marked as demo. */
export function LiveMetricCard({ label, value, hint, tone = "cyan", series, live = false, demo = false, footer }: LiveMetricCardProps) {
  return (
    <GlassPanel className="flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        <span className="flex items-center gap-2">
          {demo ? <Badge tone="warning">Demo data</Badge> : null}
          {live ? (
            <span className="flex items-center gap-1.5 text-xs text-success" data-live="true">
              <span className="size-2 rounded-full bg-success [animation:consyrion-pulse_1.6s_ease-in-out_infinite]" />
              Live
            </span>
          ) : null}
        </span>
      </div>
      <p className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight" style={{ textShadow: `0 0 24px color-mix(in oklab, ${STROKE[tone]} 35%, transparent)` }}>
        {value}
      </p>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {series ? <Sparkline values={series.values} tone={tone} label={series.label} /> : null}
      {footer}
    </GlassPanel>
  );
}
