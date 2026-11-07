import { DomainError, httpStatusFor } from "@consyrion/core";
import { assertEntitlement, resolveActor, resolveApiToken } from "@consyrion/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { handleMcpMessage } from "@/lib/server/mcp";
import { mcpTools } from "@/lib/server/mcp-tools";
import { rateLimit } from "@/lib/server/rate-limit";

/**
 * MCP server endpoint (Streamable HTTP, stateless): `POST /api/mcp` with `Authorization: Bearer <API token>`.
 * Pro and up (entitlement `mcp`; self-hosted always). Read-only tokens (cnr_) see only read tools; integration (cni_)
 * and full (cns_) tokens can also prepare projects and start councils on the workspace's own keys. See docs/mcp.md.
 */
export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new DomainError("UNAUTHENTICATED", "Send an API token as 'Authorization: Bearer …' (Settings → API tokens)");
    const db = await getDb();
    const { userId, organizationId, scope } = await resolveApiToken(db, authorization.slice(7).trim());
    const actor = await resolveActor(db, userId, organizationId);
    await assertEntitlement(db, organizationId, "mcp");
    rateLimit(`mcp:${userId}`, 120, 60_000);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
    }
    const origin = new URL(request.url).origin.replace("0.0.0.0", "localhost");
    const tools = mcpTools(db, actor, scope, process.env.BETTER_AUTH_URL?.replace(/\/$/, "") || origin);
    const messages = Array.isArray(body) ? body : [body];
    const answers = (await Promise.all(messages.map((m) => handleMcpMessage((m ?? {}) as Record<string, never>, tools)))).filter(Boolean);
    // Only notifications: 202 without body (Streamable HTTP).
    if (!answers.length) return new Response(null, { status: 202 });
    return NextResponse.json(Array.isArray(body) ? answers : answers[0]);
  } catch (error) {
    const code = error instanceof DomainError ? error.code : null;
    const status = code ? httpStatusFor(code) : 500;
    const message = error instanceof DomainError ? error.message : "Unexpected server error";
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
      { status, headers: status === 401 ? { "WWW-Authenticate": 'Bearer realm="consyrion"' } : undefined },
    );
  }
}

/** No server-initiated stream and no sessions in this stateless server. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
