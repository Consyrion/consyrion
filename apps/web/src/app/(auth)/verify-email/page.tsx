import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { safeNext, withNext } from "@/lib/safe-next";
import { getSessionUser } from "@/lib/server/actor";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("verifyTitle") };
}

/**
 * Target of the e-mail verification link. A valid link has verified the address but opens no session: the page
 * confirms it and the user signs in with e-mail and password. An invalid or expired link (`?error=…`) explains how to
 * get a new one.
 *
 * A signed-in visitor goes on to the dashboard: `callbackURL: "/verify-email"` on the e-mail sign-in is meant for the
 * verification link the server sends to an unverified address, but Better Auth's client also follows it after a
 * successful sign-in (`redirect: true`) – that used to leave verified users here, with "Sign in" leading back in a loop.
 *
 * `next` is carried through for somebody who came from the OAuth consent page (`/sign-in?next=…`): a signed-in visitor
 * goes on to it instead of the dashboard, and the "Sign in" link keeps it. Only that one target is accepted (safeNext).
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string | string[] }> }) {
  const { error, next } = await searchParams;
  const target = safeNext(next);
  if (!error && (await getSessionUser())) redirect(target ?? "/dashboard");
  const t = await getTranslations("auth");
  return (
    <div className="text-center">
      <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,3vw,42px)] leading-tight font-semibold tracking-[-0.02em]">
        {error ? t("verifyFailedTitle") : t("verifyTitle")}
      </h1>
      <p className="mt-4 text-base text-muted sm:text-lg">{error ? t("verifyFailedText") : t("verifyDoneText")}</p>
      <p className="mt-8 text-base">
        <Link className="font-semibold text-primary hover:underline" href={withNext("/sign-in", target)}>
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
