import { DomainError } from "@consyrion/core";
import { decideSkillVersion, getSkillReviewItem, type ModerationDecision } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requirePlatformAdminContext } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

type Params = { params: Promise<{ id: string; version: string }> };
const DECISIONS: ReadonlyArray<ModerationDecision> = ["approve", "reject", "quarantine", "restore"];

async function target(params: Params["params"]) {
  const p = await params;
  const version = Number(p.version);
  if (!Number.isInteger(version) || version < 1) throw new DomainError("VALIDATION", "Invalid version");
  return { skillId: decodeURIComponent(p.id), version };
}

/** One submitted version with content, both checks and the audit trail (#368 PR 5). */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const admin = await requirePlatformAdminContext();
  const { skillId, version } = await target(params);
  return NextResponse.json(await getSkillReviewItem(await getDb(), admin, skillId, version));
});

/** Decision: { decision: approve | reject | quarantine | restore, contentHash, note? }. Red is never publishable. */
export const POST = handle(async (request: Request, { params }: Params) => {
  const admin = await requirePlatformAdminContext();
  const { skillId, version } = await target(params);
  const body = ((await readJson(request)) ?? {}) as { decision?: unknown; contentHash?: unknown; note?: unknown };
  if (!DECISIONS.includes(body.decision as ModerationDecision)) throw new DomainError("VALIDATION", "Unknown decision");
  if (typeof body.contentHash !== "string") throw new DomainError("VALIDATION", "contentHash is required");
  const result = await decideSkillVersion(await getDb(), admin, {
    skillId,
    version,
    contentHash: body.contentHash,
    decision: body.decision as ModerationDecision,
    note: typeof body.note === "string" ? body.note : null,
  });
  return NextResponse.json(result);
});
