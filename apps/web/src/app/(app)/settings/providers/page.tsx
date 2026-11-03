import { can } from "@consyrion/core";
import { listCredentials } from "@consyrion/db";
import { ProviderSettings } from "@/components/provider-settings";
import { Alert, PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";

export const metadata = { title: "AI providers" };

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
  if (!can(actor.role, "credential:read")) {
    return (
      <>
        <PageHeader title="AI providers" />
        <Alert tone="warning">Your role does not allow viewing provider keys. Ask an owner or admin.</Alert>
      </>
    );
  }
  const credentials = await listCredentials(await getDb(), actor);
  return (
    <>
      <PageHeader title="AI providers" description="Connect the AI providers your council may use. Keys belong to this workspace." />
      <ProviderSettings
        initial={credentials.map((c) => ({ ...c, lastValidatedAt: c.lastValidatedAt?.toISOString() ?? null, createdAt: undefined }))}
        canWrite={can(actor.role, "credential:write")}
        keysConfigured={keysConfigured()}
      />
    </>
  );
}
