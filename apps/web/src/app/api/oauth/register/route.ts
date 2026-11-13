import { registerClient } from "@consyrium/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { clientIp } from "@/lib/server/feedback";
import { corsHeaders, corsPreflight, readOAuthBody, toOAuthErrorResponse } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rate-limit";

const METHODS = "POST, OPTIONS";

/**
 * Dynamic client registration (RFC 7591) for the OAuth sign-in – unauthenticated by design of the MCP authorization
 * flow, limited per address. Public clients only: no secret is issued, whatever the request asks for. A registration
 * grants nothing; the user decides on the consent page, which shows where the access goes. Reads no cookie, so the
 * same-origin check of `handle` does not apply and CORS is open.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`oauth-register:${clientIp(request.headers)}`, 20, 60 * 60_000);
    const body = await readOAuthBody(request, false);
    const client = await registerClient(await getDb(), { name: body.client_name, redirectUris: body.redirect_uris });
    return NextResponse.json(
      {
        client_id: client.clientId,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
      },
      { status: 201, headers: { ...corsHeaders(METHODS), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toOAuthErrorResponse(error, METHODS);
  }
}

export function OPTIONS() {
  return corsPreflight(METHODS);
}
