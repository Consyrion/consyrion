import { createAdapter, ProviderError, timeoutSignal } from "@consyrium/ai";
import type { ModelCatalog } from "@consyrium/council";
import { decryptCredentialForUse, recordModelCheck, type ActorContext, type Database } from "@consyrium/db";
import { DomainError } from "@consyrium/core";
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
  const catalog: ModelCatalog = async (credentialId) => {
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
  catalog.probe = (credentialId, modelId) => probeModel(db, actor, credentialId, modelId);
  return catalog;
}

/** Output tokens of the start check: enough for any model to answer, small enough to cost next to nothing. */
const PROBE_MAX_OUTPUT_TOKENS = 16;

/**
 * Start check of one model (one tiny call on the user's key, logged like every call). Only "model not found" (HTTP 404)
 * counts as unavailable; anything else – also a cut-off answer – proves the model can be called or says nothing.
 */
export async function probeModel(db: Database, actor: ActorContext, credentialId: string, modelId: string): Promise<"ok" | "not_found" | "unknown"> {
  const started = Date.now();
  let provider: Awaited<ReturnType<typeof decryptCredentialForUse>>["provider"];
  let secret: string;
  try {
    ({ provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), credentialId));
  } catch {
    return "unknown";
  }
  try {
    const result = await createAdapter(provider, secret).generate({
      model: modelId,
      messages: [{ role: "user", content: "Reply with OK." }],
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
      signal: timeoutSignal(20_000),
    });
    await recordModelCheck(db, actor, { provider, modelId, ok: true, ...result.usage, durationMs: Date.now() - started });
    return "ok";
  } catch (error) {
    if (!(error instanceof ProviderError)) return "unknown";
    // A cut-off or refused answer still proves the model exists; only 404 means the key may not call it.
    if (error.kind !== "model_not_found") return "unknown";
    await recordModelCheck(db, actor, {
      provider,
      modelId,
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - started,
      errorKind: "model_not_found",
      httpStatus: error.status ?? 404,
    });
    return "not_found";
  }
}
