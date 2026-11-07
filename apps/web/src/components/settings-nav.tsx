"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/workspace", label: "workspace" },
  { href: "/settings/team", label: "team" },
  { href: "/settings/billing", label: "billing" },
  { href: "/settings/account", label: "account" },
  { href: "/settings/api-tokens", label: "apiTokens" },
  { href: "/settings/feedback", label: "feedback" },
] as const;

/** Tabs for the pages grouped under "Settings" in the main navigation; hidden on AI providers and Integrations. */
export function SettingsNav() {
  const pathname = usePathname();
  const t = useTranslations("settings.nav");
  if (!TABS.some((tab) => pathname.startsWith(tab.href))) return null;
  return (
    <nav aria-label={t("label")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className="shrink-0 rounded-xl border border-glass-line px-4 py-2 text-sm text-muted hover:text-text aria-[current=page]:border-[#22d3ee]/60 aria-[current=page]:bg-[#22d3ee]/10 aria-[current=page]:text-text"
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
