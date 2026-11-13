import { appOrigin, corsPreflight, metadataResponse, protectedResourceMetadata } from "@/lib/server/oauth";

// The address comes from server env set at runtime, not at image build time.
export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP endpoint: an MCP client that got a 401 from `/api/mcp`
 * reads here which authorization server signs users in. Public, no cookies. See docs/mcp.md "Sign-in (OAuth)".
 */
export function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata(appOrigin(request)));
}

export function OPTIONS() {
  return corsPreflight("GET, OPTIONS");
}
