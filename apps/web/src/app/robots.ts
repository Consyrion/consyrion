import type { MetadataRoute } from "next";

// Built per request: the public URL (BETTER_AUTH_URL) is known at run time, not when the Docker image is built.
export const dynamic = "force-dynamic";

/**
 * QA 12.11.26: /robots.txt and /sitemap.xml answered 404. Public pages may be indexed; the signed-in app, the API and
 * internal pages may not (they redirect to sign-in anyway – this keeps crawlers from trying).
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/projects", "/sessions", "/decisions", "/settings", "/admin", "/design", "/invite", "/oauth"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
