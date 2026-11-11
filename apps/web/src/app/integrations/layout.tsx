import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { ConsyriumWordmark } from "@/components/brand/consyrium-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { buttonClasses } from "@/components/ui/button";
import { getSessionUser } from "@/lib/server/actor";

/** Public pages that show what CONSYRIUM AI connects to (08.11.26) – reachable from the homepage without signing in. */
export default async function IntegrationsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("settings.connect");
  const signedIn = Boolean(await getSessionUser());
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-glass-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 text-sm md:px-8">
          <Link href="/" aria-label="CONSYRIUM AI">
            <ConsyriumWordmark className="text-xs" />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="max-sm:hidden" />
            <Link href={signedIn ? "/dashboard" : "/sign-in"} className={buttonClasses("secondary", "whitespace-nowrap")}>
              {signedIn ? t("dashboard") : t("signIn")}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-8">{children}</main>
    </div>
  );
}
