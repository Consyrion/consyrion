import { listApiTokens } from "@consyrion/db";
import { ApiTokens } from "@/components/api-tokens";
import { PageHeader } from "@/components/ui/surface";
import { requirePageActor } from "@/lib/server/actor";
import { getDb } from "@/lib/server/db";

export const metadata = { title: "API tokens" };

export default async function ApiTokensPage() {
  const actor = await requirePageActor();
  const tokens = await listApiTokens(await getDb(), actor);
  return (
    <>
      <PageHeader
        title="API tokens"
        description="Personal tokens for integrations (API v1, docs/api.md) and the VS Code extension. A token acts as you in this workspace with your role, limited by its access; it is stored only as a hash. Integration tokens (cni_…) can run and read councils but never approve or build; VS Code needs a full-access token (cns_…)."
      />
      <ApiTokens tokens={tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, scope: t.scope, lastUsedAt: t.lastUsedAt?.toISOString() ?? null, expiresAt: t.expiresAt.toISOString() }))} />
    </>
  );
}
