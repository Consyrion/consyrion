import { createAdapter, ProviderError, timeoutSignal } from "@consyrion/ai";
import { latestStrengthCatalog } from "@consyrion/council";
import { strengthSuggestion } from "@consyrion/core";
import { decryptCredentialForUse, listCredentials } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rememberModels } from "@/lib/server/model-catalog";
import { rateLimit } from "@/lib/server/rate-limit";

/**
 * Live model registry per stored API key: each provider is asked which models this key may use.
 * Optional `?credentialId=` limits discovery to one key.
 */
export const GET = handle(async (request: Request) => {
  const actor = await requireActor({ integration: true });
  rateLimit(`models:${actor.userId}`, 20, 60_000);
  const db = await getDb();
  const only = new URL(request.url).searchParams.get("credentialId");
  const credentials = (await listCredentials(db, actor)).filter((c) => !only || c.id === only);
  // Vote-weight suggestion per model from the latest ranking (#139); "unknown" (tier 5) without one.
  const catalog = await latestStrengthCatalog(db);
  const results = await Promise.all(
    credentials.map(async (credential) => {
      try {
        const { secret } = await decryptCredentialForUse(db, actor, getKeyring(), credential.id);
        const models = await createAdapter(credential.provider, secret).listModels(timeoutSignal(15_000));
        rememberModels(
          credential.id,
          models.map((m) => m.modelId),
        );
        const withStrength = models.map((m) => ({ ...m, strength: strengthSuggestion(credential.provider, m.modelId, catalog) }));
        return { credentialId: credential.id, provider: credential.provider, label: credential.label, models: withStrength, error: null };
      } catch (error) {
        const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : "Model discovery failed";
        return { credentialId: credential.id, provider: credential.provider, label: credential.label, models: [], error: message };
      }
    }),
  );
  return NextResponse.json({ credentials: results });
});
