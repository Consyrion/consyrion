import { createAdapter, ProviderError } from "@consyrion/ai";
import { DomainError } from "@consyrion/core";
import { describeImage } from "@consyrion/council";
import { decryptCredentialForUse, getImageForDescription, setImageDescription } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { getKeyring } from "@/lib/server/keyring";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string; docId: string }> };

/**
 * One model describes an uploaded image ({ credentialId, modelId }); the text is stored as a draft for the user to
 * review (docs/documents.md). One paid call on the user's own key; the image never goes to a council.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  rateLimit(`describe-image:${actor.userId}`, 20, 60_000);
  const { id, docId } = await params;
  const body = (await readJson(request)) as { credentialId?: unknown; modelId?: unknown };
  if (typeof body.credentialId !== "string" || typeof body.modelId !== "string" || !body.modelId.trim())
    throw new DomainError("VALIDATION", "Choose a key (credentialId) and an image-capable model (modelId)");
  const db = await getDb();
  const image = await getImageForDescription(db, actor, id, docId);
  const { provider, secret } = await decryptCredentialForUse(db, actor, getKeyring(), body.credentialId);
  let described: Awaited<ReturnType<typeof describeImage>>;
  try {
    described = await describeImage(createAdapter(provider, secret), body.modelId.trim(), { mediaType: image.mediaType, data: image.data });
  } catch (error) {
    if (error instanceof ProviderError)
      throw new DomainError("PROVIDER_ERROR", `${provider}/${body.modelId}: ${error.message} – the model may not accept images; choose an image-capable model.`);
    throw error;
  }
  const describedBy = `${provider}/${body.modelId.trim()}`;
  await setImageDescription(db, actor, id, docId, { text: described.text, status: "draft", describedBy });
  return NextResponse.json({ description: described.text, descriptionStatus: "draft", describedBy, usage: described.usage });
});
