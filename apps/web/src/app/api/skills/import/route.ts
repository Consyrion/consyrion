import { DomainError } from "@consyrion/core";
import { createSkill } from "@consyrion/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/**
 * Import of a skill folder's skill.json (#363): validated and scanned like any save; the copy starts private. Fields
 * that are not part of the skill schema are not stored and come back as `ignoredFields` (#419).
 */
export const POST = handle(async (request: Request) => {
  const actor = await requireActor();
  const body = (await readJson(request)) as { skillJson?: unknown };
  if (typeof body?.skillJson !== "string") throw new DomainError("VALIDATION", "skillJson (the text of skill.json) is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.skillJson);
  } catch {
    throw new DomainError("VALIDATION", "skill.json is not valid JSON");
  }
  return NextResponse.json(await createSkill(await getDb(), actor, { content: parsed }), { status: 201 });
});
