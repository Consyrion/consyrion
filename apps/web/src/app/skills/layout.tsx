import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Public SkillHub pages (#368 PR 6): readable without login. */
export default async function SkillHubLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("skillHub");
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-glass-line">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 text-sm md:px-8">
          <Link href="/" className="font-semibold tracking-wide">
            CONSYRIUM AI
          </Link>
          <nav className="flex gap-4 text-muted">
            <Link href="/skills" className="hover:text-text">
              {t("nav.catalog")}
            </Link>
            <Link href="/dashboard" className="hover:text-text">
              {t("nav.app")}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10 md:px-8">{children}</main>
      <footer className="border-t border-glass-line">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted md:px-8">
          <span>{t("footer.license")}</span>
          <nav className="flex gap-4">
            <Link href="/impressum" className="hover:text-text">
              Impressum
            </Link>
            <Link href="/datenschutz" className="hover:text-text">
              Datenschutz
            </Link>
            <Link href="/agb" className="hover:text-text">
              AGB
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
