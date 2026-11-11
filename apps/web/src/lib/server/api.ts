import { DomainError, httpStatusFor } from "@consyrium/core";
import { NextResponse } from "next/server";
import { logger } from "./logger";
import { publicOrigin } from "./origin";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Converts thrown errors into JSON responses without leaking stack traces or internal messages. */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof DomainError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    if (error.code === "VALIDATION" && error.details !== undefined) body.error.details = error.details;
    return NextResponse.json(body, { status: httpStatusFor(error.code) });
  }
  logger.error("Unhandled API error", { error: error instanceof Error ? error.name : typeof error });
  return NextResponse.json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, { status: 500 });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Bearer requests (API tokens) carry no ambient browser credential, so a foreign page cannot forge them. */
function hasBearerToken(request: Request): boolean {
  return /^Bearer\s+\S/i.test(request.headers.get("authorization") ?? "");
}

/**
 * CSRF protection (#396) for cookie-authenticated, state-changing requests: they must come from this app's own
 * pages. Browsers send `Sec-Fetch-Site` and `Origin` on every cross-site POST, so a forged form or `fetch` from another
 * site – including a sibling subdomain ("same-site") – is refused before the handler runs. Requests without either
 * header come from non-browser clients, which cannot carry a victim's cookie.
 */
export function assertSameOrigin(request: Request, env: Record<string, string | undefined> = process.env): void {
  if (SAFE_METHODS.has(request.method.toUpperCase()) || hasBearerToken(request)) return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw new DomainError("FORBIDDEN", "Cross-site request refused");
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const allowed = new Set([publicOrigin(request, env), new URL(request.url).origin]);
  if (!allowed.has(origin)) throw new DomainError("FORBIDDEN", "Cross-site request refused");
}

export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      if (args[0] instanceof Request) assertSameOrigin(args[0]);
      return await fn(...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/**
 * Reads a JSON body. Browser requests must declare `application/json` (#396): a cross-site HTML form can only send
 * form or `text/plain` bodies, so this closes the "JSON in a text/plain form" trick even without the origin check.
 * API-token clients are not held to the header.
 */
export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!hasBearerToken(request) && !/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) throw new DomainError("VALIDATION", "Request body must be JSON (Content-Type: application/json)");
  try {
    return await request.json();
  } catch {
    throw new DomainError("VALIDATION", "Request body must be JSON");
  }
}
