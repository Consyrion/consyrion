"use client";

import Link from "next/link";
import { AssistantPanel } from "./assistant-panel";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { ConsyrionMark } from "./brand/consyrion-logo";
import { ElectricLogo } from "./brand/electric-logo";
import { AmbientBackground } from "./fx/ambient-background";
import { Icon, type IconName } from "./ui/icons";
import { Badge } from "./ui/surface";

interface NavItem {
  href: string;
  /** Message key in the `shell.nav` namespace. */
  label: string;
  icon: IconName;
  /** Other paths that count as this item (e.g. all settings pages for "Settings"). */
  also?: string[];
  /** Milestone in which the area becomes available; shown instead of a fake working page. */
  plannedFor?: string;
}

/** Settings pages grouped under one entry, as in the design concepts; the settings layout has its own tabs. */
export const SETTINGS_PATHS = ["/settings/workspace", "/settings/team", "/settings/billing", "/settings/account", "/settings/api-tokens", "/settings/feedback"];

const NAV: NavItem[] = [
  { href: "/dashboard", label: "dashboard", icon: "home" },
  { href: "/projects", label: "projects", icon: "folder" },
  { href: "/decisions", label: "decisions", icon: "decision", also: ["/sessions"] },
  { href: "/settings/providers", label: "providers", icon: "chip" },
  { href: "/settings/integrations", label: "integrations", icon: "link" },
  { href: "/settings/workspace", label: "settings", icon: "settings", also: SETTINGS_PATHS },
];

/** Mobile bottom navigation (design concept 3): the four most used destinations; the menu keeps the rest. */
const BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", label: "home", icon: "home" },
  { href: "/projects", label: "projects", icon: "folder" },
  { href: "/decisions", label: "decisions", icon: "doc", also: ["/sessions"] },
  { href: "/settings/workspace", label: "settings", icon: "settings", also: SETTINGS_PATHS },
];

export function isActive(item: Pick<NavItem, "href" | "also">, pathname: string) {
  return [item.href, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function ThemeToggle() {
  const t = useTranslations("shell");
  const [theme, setTheme] = useState<string | undefined>(() => (typeof document === "undefined" ? undefined : document.documentElement.dataset.theme));
  function toggle() {
    // Dark is the default regardless of the OS setting; only an explicit choice switches to light.
    const isDark = theme !== "light";
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("consyrion-theme", next);
    } catch {
      /* storage may be unavailable; the toggle still works for this page view */
    }
    setTheme(next);
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("toggleTheme")}
      title={t("toggleTheme")}
      className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2/70 hover:text-text"
    >
      <Icon name="sun" />
    </button>
  );
}

export function AppShell({
  user,
  organizationName,
  isAdmin = false,
  adminBadge = 0,
  showUpgrade = false,
  children,
}: {
  user: { name: string; email: string };
  organizationName: string;
  isAdmin?: boolean;
  /** Number of new feedback reports, shown next to the Admin entry (#295). */
  adminBadge?: number;
  /** Free plan, online checkout open and allowed to manage billing: a visible way to upgrade. */
  showUpgrade?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const tf = useTranslations("feedback");
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const navItems: NavItem[] = [...NAV, ...(isAdmin ? [{ href: "/admin", label: "admin", icon: "shield" as const }] : [])];

  return (
    <div className="relative isolate min-h-screen md:grid md:grid-cols-[244px_1fr]">
      <AmbientBackground className="fixed" intensity={0.45} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        {t("skip")}
      </a>
      <header className="sticky top-0 z-20 flex items-center justify-between bg-bg/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2.5" aria-label={t("homeLabel")}>
          <ConsyrionMark size={34} title="" className="drop-shadow-[0_0_10px_rgb(34_211_238/0.5)]" />
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[0.08em]">CONSYRION AI</span>
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sidebar"
          aria-label={t("menu")}
          onClick={() => setOpen((v) => !v)}
          className="grid size-11 place-items-center rounded-xl border border-glass-line bg-surface/60"
        >
          <Icon name="menu" />
        </button>
      </header>
      <aside
        id="sidebar"
        className={`${open ? "flex" : "hidden"} stage-dark relative z-10 flex-col overflow-hidden text-text border-glass-line bg-[linear-gradient(180deg,rgb(9_17_34/0.92),rgb(5_10_22/0.96))] px-3 py-4 backdrop-blur-xl md:sticky md:top-0 md:flex md:h-screen md:border-r md:px-4 md:py-7`}
      >
        {/* Decorative planet arc at the bottom of the sidebar (design concept 1). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-56 hidden size-[420px] rounded-full border border-[#2f7bff]/40 bg-[radial-gradient(circle_at_72%_28%,rgb(47_123_255/0.35),rgb(12_30_80/0.25)_38%,transparent_70%)] shadow-[0_0_80px_-12px_rgb(47_123_255/0.7)] md:block"
        />
        <Link href="/dashboard" className="relative hidden flex-col items-center gap-3 pb-9 md:flex" aria-label={t("homeLabel")}>
          <ElectricLogo size={68} mode="intro" title="" />
          <span className="font-[family-name:var(--font-display)] text-base font-medium tracking-[0.28em]">CONSYRION AI</span>
        </Link>
        <nav aria-label={t("mainNav")} className="relative flex flex-col gap-1.5">
          {navItems.map((item) =>
            item.plannedFor ? (
              <span key={item.href} className="flex items-center justify-between rounded-xl px-4 py-3 text-sm text-muted" aria-disabled="true">
                {t(`nav.${item.label}`)}
                <Badge>{item.plannedFor}</Badge>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item, pathname) ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3.5 rounded-xl border border-transparent px-4 text-[15px] text-muted transition-colors hover:bg-white/5 hover:text-text aria-[current=page]:border-[#22d3ee]/60 aria-[current=page]:bg-[linear-gradient(90deg,rgb(34_211_238/0.16),rgb(34_211_238/0.04))] aria-[current=page]:text-text aria-[current=page]:shadow-[0_0_22px_-6px_rgb(34_211_238/0.55),inset_0_0_14px_-6px_rgb(34_211_238/0.5)]"
              >
                <Icon name={item.icon} className="size-5 shrink-0" />
                {t(`nav.${item.label}`)}
                {item.href === "/admin" && adminBadge > 0 ? (
                  <span
                    className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-text"
                    title={tf("admin.newCount", { count: adminBadge })}
                  >
                    {adminBadge}
                  </span>
                ) : null}
              </Link>
            ),
          )}
        </nav>
        <div className="relative mt-auto space-y-2 pt-8">
          {showUpgrade ? (
            <Link
              href="/settings/billing#plans"
              onClick={() => setOpen(false)}
              data-testid="upgrade-link"
              className="flex items-center justify-between gap-2 rounded-xl bg-[linear-gradient(90deg,#1cc8ff,#5ef0c8)] px-3.5 py-3 text-sm font-semibold text-[#03121c] shadow-[0_0_24px_-8px_rgb(34_211_238/0.7)] hover:brightness-110"
            >
              <span className="min-w-0">
                <span className="block">{t("upgrade.title")}</span>
                <span className="block text-xs font-normal opacity-80">{t("upgrade.text")}</span>
              </span>
              <Icon name="arrow" className="size-4 shrink-0" />
            </Link>
          ) : null}
          <Link
            href="/settings/workspace"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 rounded-xl border border-glass-line bg-[rgb(9_17_34/0.8)] px-3.5 py-3 text-sm backdrop-blur hover:border-primary/50"
          >
            <span className="min-w-0">
              <span className="block text-xs text-muted">{t("workspace")}</span>
              <span className="block truncate font-medium">{organizationName}</span>
            </span>
            <Icon name="chevron" className="size-4 shrink-0 text-muted" />
          </Link>
          <div className="flex items-center gap-2 rounded-xl border border-glass-line bg-[rgb(9_17_34/0.8)] py-1.5 pr-1 pl-3 backdrop-blur">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-sm font-semibold text-primary"
            >
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm" title={user.email}>
                {user.name}
              </span>
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              aria-label={t("signOut")}
              title={t("signOut")}
              className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2/70 hover:text-text"
            >
              <Icon name="logout" />
            </button>
          </div>
          <Link
            href={`/settings/feedback?from=${encodeURIComponent(pathname)}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-1 text-sm text-muted hover:text-text"
          >
            <Icon name="alert" className="size-4 shrink-0" />
            {tf("nav")}
          </Link>
          {/* AGPL-3.0 §13: users of the hosted app get a link to its source code. */}
          <a href="https://github.com/Consyrion/consyrion" target="_blank" rel="noreferrer" className="block px-1 text-xs text-muted hover:text-text">
            {t("source")}
          </a>
        </div>
      </aside>
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1680px] px-4 pt-4 pb-32 md:px-8 md:py-8 xl:px-10">
        {children}
      </main>
      <nav
        aria-label={t("quickNav")}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 gap-1 border-t border-glass-line bg-[rgb(5_10_22/0.88)] px-3 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden"
      >
        {BOTTOM_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item, pathname) ? "page" : undefined}
            className="relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs text-muted aria-[current=page]:text-primary aria-[current=page]:after:absolute aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:w-8 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-primary aria-[current=page]:after:shadow-[0_0_10px_var(--glow-cyan)]"
          >
            <Icon name={item.icon} className="size-6" />
            {t(`nav.${item.label}`)}
          </Link>
        ))}
      </nav>
      <AssistantPanel />
    </div>
  );
}
