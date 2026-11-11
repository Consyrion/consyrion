import { exportPatch } from "@consyrium/build";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** The change set as a `git apply`-compatible patch, e.g. to review or apply it in VS Code. */
export const GET = handle(async (_request: Request, { params }: { params: Promise<{ planId: string }> }) => {
  const actor = await requireActor();
  const planId = (await params).planId;
  return new Response(await exportPatch(await getDb(), actor, planId), {
    headers: { "Content-Type": "text/x-diff; charset=utf-8", "Content-Disposition": `attachment; filename="consyrium-${planId}.patch"` },
  });
});
