import { getTranslations } from "next-intl/server";
import { SignInMethods } from "@/components/sign-in-methods";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { enabledSocialProviders } from "@/lib/server/auth";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("account.title") };
}

export default async function AccountPage() {
  await requirePageActor();
  const t = await getTranslations("settings.pages.account");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SignInMethods providers={enabledSocialProviders} />
    </>
  );
}
