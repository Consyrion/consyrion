import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("verifyTitle") };
}

/**
 * Target of the e-mail verification link. A valid link has verified the address but opens no session: the page
 * confirms it and the user signs in with e-mail and password. An invalid or expired link (`?error=…`) explains how to
 * get a new one.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <div className="text-center">
      <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,3vw,42px)] leading-tight font-semibold tracking-[-0.02em]">
        {error ? t("verifyFailedTitle") : t("verifyTitle")}
      </h1>
      <p className="mt-4 text-base text-muted sm:text-lg">{error ? t("verifyFailedText") : t("verifyDoneText")}</p>
      <p className="mt-8 text-base">
        <Link className="font-semibold text-primary hover:underline" href="/sign-in">
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
