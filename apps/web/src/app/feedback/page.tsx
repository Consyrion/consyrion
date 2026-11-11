import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ConsyriumWordmark } from "@/components/brand/consyrium-logo";
import { FeedbackForm } from "@/components/feedback";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Card } from "@/components/ui/surface";
import { getSessionUser } from "@/lib/server/actor";

export async function generateMetadata() {
  const t = await getTranslations("feedback");
  return { title: t("visitorTitle") };
}

/** Public contact and feedback form (#295). Signed-in users are sent to "My reports", where they also see answers. */
export default async function PublicFeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const safeFrom = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  if (await getSessionUser()) redirect(`/settings/feedback?from=${encodeURIComponent(safeFrom)}`);
  const t = await getTranslations("feedback");
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-glass-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 text-sm md:px-8">
          <Link href="/" aria-label="CONSYRIUM AI">
            <ConsyriumWordmark className="text-xs" />
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">{t("visitorTitle")}</h1>
        <p className="mt-1 mb-6 text-muted">{t("visitorDescription")}</p>
        <Card>
          <FeedbackForm visitor from={safeFrom} />
        </Card>
        <p className="mt-6 text-sm text-muted">
          {t("haveAccount")}{" "}
          <Link href="/sign-in" className="underline hover:text-text">
            {t("signIn")}
          </Link>
        </p>
      </main>
    </div>
  );
}
