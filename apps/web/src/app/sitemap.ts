import type { MetadataRoute } from "next";

// Built per request: the public URL (BETTER_AUTH_URL) is known at run time, not when the Docker image is built.
export const dynamic = "force-dynamic";

/** The public pages of the hosted app (QA 12.11.26); everything else needs a sign-in and is not listed. */
const PUBLIC_PATHS = ["/", "/integrations", "/skills", "/sign-up", "/sign-in", "/impressum", "/agb", "/datenschutz", "/feedback"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path === "/" ? "" : path}` || base,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
