import { can } from "@consyrion/core";
import { listCredentials } from "@consyrion/db";
import { getTranslations } from "next-intl/server";
import { ProviderSettings } from "@/components/provider-settings";
import { Alert, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

export async function generateMetadata() {
  const t = await getTranslations("settings.pages");
  return { title: t("providers.title") };
}

function keysConfigured() {
  try {
    getKeyring();
    return true;
  } catch {
    return false;
  }
}

export default async function ProvidersPage() {
  const actor = await requirePageActor();
  const t = await getTranslations("settings.pages.providers");
  if (!can(actor.role, "credential:read")) {
    return (
      <>
        <PageHeader title={t("title")} />
        <Alert tone="warning">{t("noAccess")}</Alert>
      </>
    );
  }
  const credentials = await listCredentials(await getDb(), actor);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ProviderSettings
        initial={credentials.map((c) => ({ ...c, lastValidatedAt: c.lastValidatedAt?.toISOString() ?? null, createdAt: undefined }))}
        canWrite={can(actor.role, "credential:write")}
        keysConfigured={keysConfigured()}
      />
    </>
  );
}
