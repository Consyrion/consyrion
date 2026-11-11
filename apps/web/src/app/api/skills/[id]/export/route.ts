import { exportSkillFiles } from "@consyrium/core";
import { getSkillForUse, listSkillVersions } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/**
 * Export of a skill folder (#363): SKILL.md + skill.json, ready to share via Git or import elsewhere. SKILL.md carries
 * YAML frontmatter, the changelog and the origin of a duplicate (#422); skill.json stays the content's only source.
 */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor();
  const db = await getDb();
  const id = decodeURIComponent((await params).id);
  const { content, ref, forkedFrom } = await getSkillForUse(db, actor, id);
  const versions = await listSkillVersions(db, actor, id);
  const changelog = versions.filter((v) => v.changelog).map((v) => ({ version: v.version, changelog: v.changelog! }));
  return NextResponse.json({ ref, files: exportSkillFiles(content, { version: ref.version, changelog, forkedFrom }) });
});
