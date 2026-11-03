"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/workspace", label: "Workspace" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/billing", label: "Billing & usage" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/api-tokens", label: "API tokens" },
];

/** Tabs for the pages grouped under "Settings" in the main navigation; hidden on AI providers and Integrations. */
export function SettingsNav() {
  const pathname = usePathname();
  if (!TABS.some((tab) => pathname.startsWith(tab.href))) return null;
  return (
    <nav aria-label="Settings" className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname.startsWith(tab.href) ? "page" : undefined}
          className="shrink-0 rounded-xl border border-glass-line px-4 py-2 text-sm text-muted hover:text-text aria-[current=page]:border-[#22d3ee]/60 aria-[current=page]:bg-[#22d3ee]/10 aria-[current=page]:text-text"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
