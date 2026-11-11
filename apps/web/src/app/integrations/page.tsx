import { getTranslations } from "next-intl/server";
import { ConnectGrid } from "@/components/connect/connect-grid";
import { PageHeader } from "@/components/ui/surface";

export async function generateMetadata() {
  const t = await getTranslations("settings.connect");
  return { title: t("publicTitle"), description: t("publicDescription") };
}

/** Public overview of every tool CONSYRIUM AI connects to; same grid as Settings → Integrations. */
export default async function PublicIntegrationsPage() {
  const t = await getTranslations("settings.connect");
  return (
    <>
      <PageHeader title={t("publicTitle")} description={t("publicDescription")} />
      <ConnectGrid />
    </>
  );
}
