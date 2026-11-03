import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Next.js needs inline scripts for hydration; everything else is restricted to this origin and the
// OAuth/checkout hosts users are sent to.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com https://accounts.google.com https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  transpilePackages: ["@consyrion/core", "@consyrion/db", "@consyrion/ai", "@consyrion/council", "@consyrion/engine", "@consyrion/build", "@consyrion/github", "@consyrion/billing"],
  serverExternalPackages: ["@electric-sql/pglite", "pg", "unpdf"],
  poweredByHeader: false,
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // Agent guidance lives in the repository CLAUDE.md; do not generate a second file.
  agentRules: false,
  // Versioned API (#101): /api/v1/... is the stable contract for integrations and serves the same handlers as /api/...
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: "/api/:path*" }];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
