/** Error codes that the API layer maps to HTTP status codes. */
export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "BUDGET_EXCEEDED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "CONFIGURATION";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  CONFIGURATION: 503,
};

export function httpStatusFor(code: DomainErrorCode): number {
  return HTTP_STATUS[code];
}
