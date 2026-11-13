import { appOrigin, corsPreflight, metadataResponse, protectedResourceMetadata } from "@/lib/server/oauth";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 §3.1 puts the metadata of the resource `<origin>/api/mcp` at this path; clients try it before the root
 * document (`/.well-known/oauth-protected-resource`), which answers the same.
 */
export function GET(request: Request) {
  return metadataResponse(protectedResourceMetadata(appOrigin(request)));
}

export function OPTIONS() {
  return corsPreflight("GET, OPTIONS");
}
