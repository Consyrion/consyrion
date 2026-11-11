import { suspendGitHubInstallation, unsuspendGitHubInstallation } from "@consyrium/db";
import { verifyWebhookSignature } from "@consyrium/github";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { githubConfig } from "@/lib/server/github";

/** Installation lifecycle webhooks. Unsigned or wrongly signed deliveries are rejected. */
export async function POST(request: Request) {
  const config = githubConfig();
  if (!config) return NextResponse.json({ error: "not configured" }, { status: 404 });
  const body = await request.text();
  if (!verifyWebhookSignature(config.webhookSecret, body, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body) as { action?: string; installation?: { id: number } };
  const installationId = payload.installation?.id;
  if (event === "installation" && installationId) {
    const db = await getDb();
    if (payload.action === "deleted" || payload.action === "suspend") await suspendGitHubInstallation(db, installationId);
    if (payload.action === "unsuspend") await unsuspendGitHubInstallation(db, installationId);
  }
  return NextResponse.json({ ok: true });
}
