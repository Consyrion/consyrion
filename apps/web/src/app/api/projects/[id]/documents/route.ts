import { DomainError } from "@consyrion/core";
import { addDocument, DOCUMENT_LIMITS, listDocuments } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  return NextResponse.json({ documents: await listDocuments(await getDb(), actor, (await params).id), limits: DOCUMENT_LIMITS });
});

export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
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
