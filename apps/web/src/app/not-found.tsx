import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ConsyriumMark } from "@/components/brand/consyrium-logo";
import { buttonClasses } from "@/components/ui/button";
import { getSessionUser } from "@/lib/server/actor";

export async function generateMetadata() {
  return { title: (await getTranslations("notFound"))("title") };
}

/**
 * QA 12.11.26: an unknown address showed Next.js's white, English default page without a way back. Same look as the
 * app, in the page language, with the one next step: home for visitors, the dashboard for signed-in users.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");
  const signedIn = Boolean(await getSessionUser());
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-16 text-text">
      <div className="glass w-full max-w-md rounded-2xl p-8 text-center">
        <ConsyriumMark size={48} className="mx-auto" />
        <p className="mt-6 font-mono text-sm text-muted">404</p>
        <h1 className="mt-1 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-3 text-sm text-muted">{t("text")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={signedIn ? "/dashboard" : "/"} className={buttonClasses("primary")}>
            {signedIn ? t("dashboard") : t("home")}
          </Link>
          {signedIn ? (
            <Link href="/" className={buttonClasses("secondary")}>
              {t("home")}
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
