import { appOrigin, authorizationServerMetadata, corsPreflight, metadataResponse } from "@/lib/server/oauth";

// The address comes from server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414): where to register, where the user consents and where a code is
 * exchanged. Authorization code with PKCE (S256) for public clients only. Public, no cookies.
 */
export function GET(request: Request) {
  return metadataResponse(authorizationServerMetadata(appOrigin(request)));
}

export function OPTIONS() {
  return corsPreflight("GET, OPTIONS");
}
