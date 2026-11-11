import { setDemoTemplate } from "@consyrium/db";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/server/actor";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { handle, readJson } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

/** Platform admin: demo template per interface language (owner decision 08.11.26, docs/demo-project.md). */
export const PUT = handle(async (request: Request) => {
  await requirePlatformAdmin();
  const actor = await requireActor();
  const body = (await readJson(request)) as { locale?: unknown; sessionId?: unknown };
  const templates = await setDemoTemplate(
    await getDb(),
    actor,
    String(body.locale ?? ""),
    typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null,
  );
  return NextResponse.json({ templates });
});
