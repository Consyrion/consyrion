import { exportOrganization } from "@consyrium/db";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const GET = handle(async () => {
  const actor = await requireActor();
  const data = await exportOrganization(await getDb(), actor);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="consyrium-export-${actor.organizationId}.json"` },
  });
});
