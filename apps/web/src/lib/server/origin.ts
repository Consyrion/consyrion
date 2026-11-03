/**
 * The public origin of this installation for links and redirects. Behind the reverse proxy `request.url` is the
 * container's own address (http://0.0.0.0:3000), so the configured BETTER_AUTH_URL wins; the request origin is only
 * the fallback for local development.
 */
export function publicOrigin(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.BETTER_AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed value falls back to the request.
    }
  }
  return new URL(request.url).origin;
}
