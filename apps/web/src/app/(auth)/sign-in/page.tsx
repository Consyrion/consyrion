import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";
import { enabledSocialProviders } from "@/lib/server/auth";

// Rendered per request: the Google/GitHub buttons depend on server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signIn") };
}

export default function SignInPage() {
  return <AuthForm mode="sign-in" socialProviders={enabledSocialProviders} />;
}
