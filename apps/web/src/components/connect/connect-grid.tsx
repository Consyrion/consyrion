import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CONNECT_CATEGORIES, CONNECT_ITEMS, connectHref, type ConnectItem } from "@/lib/connect-catalog";
import { ConnectIcon } from "./connect-icon";

/**
 * "Connect your tools" – a calm card grid in the style of an integrations directory (08.11.26).
 * Each card links to its public setup page or to the section in Settings → Integrations where it is managed; planned tools
 * are marked. Without `mcpAllowed` (public page) tools that need the MCP entitlement carry a "Pro" badge.
 */
export async function ConnectGrid({ mcpAllowed = false }: { mcpAllowed?: boolean }) {
  const t = await getTranslations("settings.connect");
  return (
    <div className="space-y-10">
      {CONNECT_CATEGORIES.map((category) => (
        <section key={category} aria-labelledby={`connect-${category}`}>
          <h2 id={`connect-${category}`} className="font-semibold">
            {t(`categories.${category}.title`)}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t(`categories.${category}.description`)}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {CONNECT_ITEMS.filter((i) => i.category === category).map((item) => (
              <li key={item.slug}>
                <ConnectCard item={item} mcpAllowed={mcpAllowed} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

async function ConnectCard({ item, mcpAllowed }: { item: ConnectItem; mcpAllowed: boolean }) {
  const t = await getTranslations("settings.connect");
  const href = connectHref(item);
  const badge = item.status === "planned" ? t("planned") : item.needsMcp && !mcpAllowed ? t("proBadge") : null;
  const body = (
    <>
      <div className="flex items-start gap-3">
        <ConnectIcon name={item.icon} brand={item.brand} />
        <div className="min-w-0">
          <p className="font-medium leading-tight">{t(`items.${item.slug}.name`)}</p>
          <p className="mt-0.5 text-xs text-muted">{t(`items.${item.slug}.by`)}</p>
        </div>
        {badge ? <span className="ml-auto shrink-0 rounded-full border border-glass-line px-2 py-0.5 text-[11px] text-muted">{badge}</span> : null}
      </div>
      <p className="mt-4 line-clamp-2 text-sm text-muted">{t(`items.${item.slug}.summary`)}</p>
    </>
  );
  const base = "glass-quiet block h-full rounded-xl p-4 transition-colors";
  if (!href) return <div className={`${base} opacity-70`}>{body}</div>;
  return (
    <Link href={href} className={`${base} hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-focus`}>
      {body}
    </Link>
  );
}
