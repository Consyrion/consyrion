import { useTranslations } from "next-intl";
import Link from "next/link";
import { MarkShapes } from "../brand/consyrion-logo";
import { buttonClasses } from "../ui/button";
import { Icon, type IconName } from "../ui/icons";

/**
 * Dashboard empty state (#81): the original mark with inactive, dashed orbits and empty model slots – clearly not
 * a running council – plus the one real next setup step from the dashboard's next-action logic.
 */
export function EmptyCouncil({ next }: { next: { href: string; icon: IconName; title: string; text: string; action: string } }) {
  const t = useTranslations("dashboard.empty");
  return (
    <section aria-labelledby="empty-council-title" className="glass flex min-w-0 flex-col items-center gap-6 rounded-2xl p-5 md:flex-row md:p-8 lg:col-start-1 lg:row-start-1">
      <svg viewBox="-110 -80 220 160" className="w-48 shrink-0 md:w-64" aria-hidden="true">
        <defs>
          <linearGradient id="empty-mark" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="#9fc4ff" strokeOpacity="0.28">
          <ellipse rx="100" ry="38" strokeDasharray="3 6" />
          <ellipse rx="70" ry="62" strokeDasharray="2 7" strokeOpacity="0.18" />
        </g>
        {/* Empty model slots: dashed, no colour, no state. */}
        {[
          [-100, 0],
          [100, 0],
          [0, -62],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="11" fill="var(--bg)" stroke="#9fc4ff" strokeOpacity="0.45" strokeDasharray="3 4" />
        ))}
        <circle r="34" fill="#071226" stroke="#22d3ee" strokeOpacity="0.6" strokeWidth="1.5" />
        <g transform="translate(-22.4 -22.4) scale(0.7)" fill="none">
          <MarkShapes stroke="url(#empty-mark)" />
        </g>
      </svg>
      <div className="min-w-0 text-center md:text-left">
        <h2 id="empty-council-title" className="font-[family-name:var(--font-display)] text-xl font-semibold md:text-2xl">
          {t("title")}
        </h2>
        <p className="mt-2 max-w-md text-muted">
          {t("text")}
        </p>
        <p className="mt-4 text-sm font-medium">{t("next", { title: next.title })}</p>
        <Link href={next.href} className={buttonClasses("primary", "mt-3 h-11 rounded-xl px-5 font-semibold")}>
          <Icon name={next.icon} className="size-4" /> {next.action}
        </Link>
      </div>
    </section>
  );
}
