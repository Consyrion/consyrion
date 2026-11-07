import { useTranslations } from "next-intl";
import Link from "next/link";
import { MarkShapes } from "../brand/consyrion-logo";
import { Icon } from "../ui/icons";
import { PROVIDER_COLOR, PROVIDER_NAME, type ActivityNode } from "./activity-network-data";

/** The provider's initial, not A/B/C: those letters belong to the proposals of the verdict (QA 07.11.26). */
const providerInitial = (provider: string) => (PROVIDER_NAME[provider] ?? provider).charAt(0).toUpperCase();

/** Positions around the brand core in the compact graphic: left and right first, then above and below. */
const SLOTS = [
  { x: 42, y: 52 },
  { x: 258, y: 52 },
  { x: 92, y: 20 },
  { x: 208, y: 20 },
  { x: 92, y: 84 },
  { x: 208, y: 84 },
];

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
}

/** Brand core with up to six lettered model nodes – the compact council graphic for small screens (#83). */
export function CompactNetwork({ nodes, className = "" }: { nodes: ActivityNode[]; className?: string }) {
  const shown = nodes.slice(0, SLOTS.length);
  return (
      <svg viewBox="0 0 300 104" className={`h-auto w-full ${className}`} aria-hidden="true">
        <defs>
          <linearGradient id="lcc-mark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
          <filter id="lcc-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {shown.map((node, i) => {
          const slot = SLOTS[i]!;
          const color = PROVIDER_COLOR[node.provider] ?? "#22d3ee";
          const mx = (slot.x + 150) / 2;
          return (
            <g key={`l-${node.id}`} fill="none" stroke={color} opacity={node.state === "idle" ? 0.4 : 1}>
              <path d={`M${slot.x} ${slot.y} Q ${mx} ${slot.y} 150 52`} strokeWidth={6} strokeOpacity={0.18} />
              <path d={`M${slot.x} ${slot.y} Q ${mx} ${slot.y} 150 52`} strokeWidth={1.5} />
            </g>
          );
        })}
        <circle cx="150" cy="52" r="26" fill="#22d3ee" opacity="0.3" filter="url(#lcc-glow)" />
        <circle cx="150" cy="52" r="24" fill="#071226" stroke="#22d3ee" strokeWidth="1.8" />
        <g transform="translate(134 36) scale(0.5)" fill="none">
          <MarkShapes stroke="url(#lcc-mark)" />
        </g>
        {shown.map((node, i) => {
          const slot = SLOTS[i]!;
          const color = node.state === "failed" ? "var(--danger)" : (PROVIDER_COLOR[node.provider] ?? "#22d3ee");
          return (
            <g key={node.id}>
              <circle cx={slot.x} cy={slot.y} r="18" fill={color} opacity="0.35" filter="url(#lcc-glow)" />
              <circle cx={slot.x} cy={slot.y} r="16" fill="#071226" stroke={color} strokeWidth="2.5" strokeDasharray={node.state === "working" ? "20 6" : undefined} />
              <text x={slot.x} y={slot.y + 6} textAnchor="middle" fontSize="16" fontWeight="700" fill="#ffffff">
                {providerInitial(node.provider)}
              </text>
            </g>
          );
        })}
      </svg>
  );
}

/**
 * Mobile council card (design concept 3, #83): brand core with the session's real models as lettered nodes,
 * their states in text, phase and token use. Replaces the large desktop network instead of squeezing it.
 */
export function LiveCouncilCompact(props: { href: string; live: boolean; status: string; project: string; phase: string; phaseLine: string; nodes: ActivityNode[]; used: number; budget: number }) {
  const { href, live, status, project, phase, phaseLine, nodes, used, budget } = props;
  const share = budget ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const shown = nodes.slice(0, SLOTS.length);
  const t = useTranslations("dashboard");
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted">{live ? t("compact.live") : t("compact.latest")}</p>
        <p className={`flex items-center gap-1.5 text-xs font-semibold tracking-wide ${live ? "text-success" : "text-muted"}`}>
          <span aria-hidden="true" className={`size-2 rounded-full ${live ? "bg-success" : "bg-muted"}`} />
          {status}
        </p>
      </div>
      <Link href={href} className="mt-2 block font-[family-name:var(--font-display)] text-xl leading-snug font-semibold break-words text-text hover:text-primary">
        {project}
      </Link>
      <p className="text-sm text-muted">
        {phase}
        {phaseLine ? ` · ${phaseLine}` : ""}
      </p>
      <CompactNetwork nodes={shown} className="mt-3" />
      <ul className="mt-2 space-y-1 text-sm" aria-label={t("compact.models", { n: nodes.length })}>
        {shown.map((node) => (
          <li key={node.id} className="flex items-center gap-2">
            <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold" style={{ borderColor: PROVIDER_COLOR[node.provider] ?? "#22d3ee" }}>
              {providerInitial(node.provider)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {PROVIDER_NAME[node.provider] ?? node.provider} <span className="text-muted">· {node.model}</span>
            </span>
            <span className={`text-xs ${node.state === "done" ? "text-success" : node.state === "failed" ? "text-danger" : "text-muted"}`}>{t(`nodeState.${node.state}`)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3 border-t border-glass-line pt-3 text-sm">
        <Icon name="database" className="size-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">{t("compact.tokens")}</span>
          <span className="font-semibold tabular-nums">
            {compact(used)} <span className="font-normal text-muted">/ {compact(budget)}</span>
          </span>
        </span>
        <span className="h-2 w-28 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--accent))]" style={{ width: `${share}%` }} />
        </span>
      </div>
    </div>
  );
}
