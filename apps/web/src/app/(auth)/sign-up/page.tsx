import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";
import { safeNext } from "@/lib/safe-next";
import { enabledSocialProviders } from "@/lib/server/auth";

// Rendered per request: the Google/GitHub buttons depend on server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("createAccount") };
}

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="sign-up" socialProviders={enabledSocialProviders} next={safeNext(next)} />;
}
