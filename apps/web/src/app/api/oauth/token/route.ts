import { OAuthError } from "@consyrium/core";
import { exchangeAuthorizationCode } from "@consyrium/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { clientIp } from "@/lib/server/feedback";
import { corsHeaders, corsPreflight, readOAuthBody, toOAuthErrorResponse } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rate-limit";

const METHODS = "POST, OPTIONS";
/** OAuth scope name for the token scope a code carries. */
const SCOPE_NAME = { integration: "councils", read: "read" } as const;

/**
 * Token endpoint of the OAuth sign-in: exchanges a one-time authorization code and its PKCE verifier for an API token
 * (`grant_type=authorization_code` only – no refresh tokens, no client secrets). The access token is an ordinary API
 * token: listed and revocable under Settings → API tokens. Reads no cookie; the caller is authenticated by code and
 * verifier alone, so CORS is open and the same-origin check of `handle` does not apply. The answer is never cached.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`oauth-token:${clientIp(request.headers)}`, 30, 60_000);
    const body = await readOAuthBody(request, true);
    if (body.grant_type !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Only grant_type=authorization_code is supported");
    for (const name of ["code", "redirect_uri", "client_id", "code_verifier"])
      if (typeof body[name] !== "string" || !body[name]) throw new OAuthError("invalid_request", `${name} is required`);
    const result = await exchangeAuthorizationCode(await getDb(), {
      code: body.code,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeVerifier: body.code_verifier,
    });
    return NextResponse.json(
      { access_token: result.token, token_type: "Bearer", expires_in: result.expiresIn, scope: SCOPE_NAME[result.scope] },
      { headers: { ...corsHeaders(METHODS), "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (error) {
    return toOAuthErrorResponse(error, METHODS);
  }
}

export function OPTIONS() {
  return corsPreflight(METHODS);
}
