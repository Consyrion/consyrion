import Link from "next/link";
import { hasPlaceholders, LEGAL_UPDATED } from "@/lib/legal";

/** Public legal pages (Impressum, AGB, Datenschutz) – German, the binding language for the hosted service. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-glass-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 text-sm md:px-8">
          <Link href="/" className="font-semibold tracking-wide">
            CONSYRION AI
          </Link>
          <nav className="flex gap-4 text-muted">
            <Link href="/impressum" className="hover:text-text">
              Impressum
            </Link>
            <Link href="/agb" className="hover:text-text">
              AGB
            </Link>
            <Link href="/datenschutz" className="hover:text-text">
              Datenschutz
            </Link>
          </nav>
        </div>
      </header>
      <main className="legal mx-auto max-w-3xl px-4 py-10 md:px-8">
        {hasPlaceholders() ? (
          <p role="status" className="mb-8 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            Entwurf: Angaben in [eckigen Klammern] werden vor dem Start des kostenpflichtigen Angebots ergänzt.
          </p>
        ) : null}
        {children}
        <p className="mt-12 text-xs text-muted">Stand: {LEGAL_UPDATED}</p>
      </main>
    </div>
  );
}
