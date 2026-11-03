/** Client-side JSON fetch that surfaces the API's error message and field errors. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldErrors = body?.error?.details?.fieldErrors ?? {};
    throw new ApiRequestError(body?.error?.message ?? `Request failed (${response.status})`, response.status, fieldErrors);
  }
  return body as T;
}
