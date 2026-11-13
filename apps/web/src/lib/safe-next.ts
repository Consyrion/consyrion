/**
 * Where sign-in may send somebody afterwards (`/sign-in?next=…`). Only one target exists: the consent page of the
 * OAuth sign-in on this origin, which sends signed-out visitors here. Anything else – another path, another origin,
 * `//host`, a scheme, a backslash, control characters, an overlong value – is dropped and the dashboard is used, so the
 * parameter can never be turned into an open redirect.
 */
export const NEXT_PREFIX = "/oauth/authorize?";
const MAX_NEXT_LENGTH = 2000;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0020\u007f-\u009f\\#]|\/\//;

export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_NEXT_LENGTH) return null;
  if (!value.startsWith(NEXT_PREFIX) || UNSAFE.test(value)) return null;
  try {
    const url = new URL(value, "https://next.invalid");
    return url.origin === "https://next.invalid" && url.pathname === "/oauth/authorize" ? value : null;
  } catch {
    return null;
  }
}

/** `/sign-in` or `/sign-up` with the target carried along (only when it is a safe one). */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
