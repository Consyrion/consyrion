import { DomainError, httpStatusFor } from "@consyrion/core";
import { NextResponse } from "next/server";
import { logger } from "./logger";

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

export function handle<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError("VALIDATION", "Request body must be JSON");
  }
}
