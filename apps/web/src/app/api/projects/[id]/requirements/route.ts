import { confirmRequirementList, listRequirementLists, proposeRequirementList } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string }> };

/**
 * Requirement intake (#190). GET returns the server's proposal for the current brief and documents, whether the latest
 * confirmed list still matches them, and every confirmed version. The extraction runs only here, on the server.
 */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  const db = await getDb();
  const id = (await params).id;
  const [proposal, history] = await Promise.all([proposeRequirementList(db, actor, id), listRequirementLists(db, actor, id)]);
  return NextResponse.json({ proposal, history });
});

/** Confirms a new list version: { sourceHash, items: [{ text, candidateKey? }], excluded: [{ candidateKey, reason }], noHardRequirements? }. */
export const POST = handle(async (request: Request, { params }: Params) => {
  const actor = await requireActor({ integration: true });
  const list = await confirmRequirementList(await getDb(), actor, (await params).id, (await readJson(request)) as never);
  return NextResponse.json({ list }, { status: 201 });
});
