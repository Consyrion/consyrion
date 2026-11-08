import { DomainError } from "@consyrion/core";
import { addDocument, DOCUMENT_LIMITS, listDocuments } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { rateLimit } from "@/lib/server/rate-limit";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ documents: await listDocuments(await getDb(), actor, (await params).id), limits: DOCUMENT_LIMITS });
});

export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  // Office text extraction is CPU- and memory-heavy (#401): a few uploads per minute per user are plenty.
  rateLimit(`documents:${actor.userId}`, 10, 60_000);
  // formData() buffers the whole body, so refuse an oversized body by its declared length first (#401); Caddy also
  // caps the request body (deploy/hetzner/Caddyfile). The multipart envelope adds a little to the file size.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > DOCUMENT_LIMITS.maxUploadBytes + 64_000) throw new DomainError("VALIDATION", `Files may be at most ${DOCUMENT_LIMITS.maxUploadBytes / 1_000_000} MB`);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new DomainError("VALIDATION", "Send the document as multipart field 'file'");
  // Coarse limit before reading the body; addDocument applies the exact limit per file type.
  if (file.size > DOCUMENT_LIMITS.maxUploadBytes) throw new DomainError("VALIDATION", `Files may be at most ${DOCUMENT_LIMITS.maxUploadBytes / 1_000_000} MB`);
  const document = await addDocument(await getDb(), actor, (await params).id, {
    name: file.name,
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return NextResponse.json({ document }, { status: 201 });
});
