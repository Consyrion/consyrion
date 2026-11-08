import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";
import { enabledSocialProviders, passwordResetEnabled } from "@/lib/server/auth";

// Rendered per request: the Google/GitHub buttons depend on server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <AuthForm mode="sign-in" socialProviders={enabledSocialProviders} passwordReset={passwordResetEnabled} oauthError={error ?? null} />;
}
