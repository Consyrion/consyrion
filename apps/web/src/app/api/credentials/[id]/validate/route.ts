import { createAdapter, ProviderError, timeoutSignal } from "@consyrium/ai";
import { decryptCredentialForUse, recordCredentialValidation } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

/** Checks a stored key by listing the provider's models. No tokens are generated, so this costs nothing. */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  rateLimit(`validate:${actor.userId}`, 20, 60_000);
  const db = await getDb();
  const id = (await params).id;
  const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), id);
  try {
    const models = await createAdapter(provider, secret).listModels(timeoutSignal(15_000));
    await recordCredentialValidation(db, actor, id, null);
    return NextResponse.json({ valid: true, modelCount: models.length });
  } catch (error) {
    const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : "Validation failed";
    await recordCredentialValidation(db, actor, id, message);
    return NextResponse.json({ valid: false, error: message });
  }
});
