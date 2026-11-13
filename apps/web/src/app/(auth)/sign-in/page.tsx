import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";
import { safeNext } from "@/lib/safe-next";
import { enabledSocialProviders, passwordResetEnabled } from "@/lib/server/auth";

// Rendered per request: the Google/GitHub buttons depend on server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string | string[] }> }) {
  const { error, next } = await searchParams;
  // `next` brings somebody back to the OAuth consent page that sent them here; every other value is dropped.
  return (
    <AuthForm mode="sign-in" socialProviders={enabledSocialProviders} passwordReset={passwordResetEnabled} oauthError={error ?? null} next={safeNext(next)} />
  );
}
