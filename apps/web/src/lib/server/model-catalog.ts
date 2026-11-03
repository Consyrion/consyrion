import { createAdapter, ProviderError, timeoutSignal } from "@consyrion/ai";
import type { ModelCatalog } from "@consyrion/council";
import { decryptCredentialForUse, type ActorContext, type Database } from "@consyrion/db";
import { DomainError } from "@consyrion/core";
import { getKeyring } from "./keyring";
import { logger } from "./logger";

/** Model lists change rarely; one listing per key is reused for this long. */
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; models: string[] }>();

/** Remembers a listing made elsewhere (the model picker), so starting a council needs no second request. */
export function rememberModels(credentialId: string, models: string[]) {
  cache.set(credentialId, { at: Date.now(), models });
}

/**
 * The live model ids of a stored key for the server-side check when a council starts (#144). An invalid key is
 * refused; when the provider cannot be reached the check is skipped (null) – the run then reports the provider error.
 */
export function modelCatalog(db: Database, actor: ActorContext): ModelCatalog {
  return async (credentialId) => {
    const hit = cache.get(credentialId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.models;
    try {
      const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), credentialId);
      const models = (await createAdapter(provider, secret).listModels(timeoutSignal(15_000))).map((m) => m.modelId);
      rememberModels(credentialId, models);
      return models;
    } catch (error) {
      if (error instanceof ProviderError && error.kind === "auth")
        throw new DomainError("VALIDATION", `The ${error.provider} API key was rejected by the provider`);
      if (error instanceof DomainError) throw error;
      logger.warn("model list unavailable; start not checked against it", { kind: error instanceof ProviderError ? error.kind : "unknown" });
      return null;
    }
  };
}
