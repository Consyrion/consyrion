import { defineConfig, devices } from "@playwright/test";

/**
 * Auth E2E tests (`pnpm --filter @consyrium/web e2e`) against the production build (`next start`) with a real
 * PostgreSQL database (`E2E_DATABASE_URL`, an empty test database migrated with `pnpm db:migrate`) and a
 * local test mail server that catches verification and reset links (e2e/smtp-sink.mjs).
 *
 * The post-deploy smoke check (`e2e:smoke`) uses the same runner against a deployed URL instead; see e2e/README.md.
 */
const smoke = Boolean(process.env.SMOKE_BASE_URL);
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = smoke ? process.env.SMOKE_BASE_URL : `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: smoke ? "smoke.e2e.ts" : "auth.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL, locale: "en-US", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: smoke
    ? undefined
    : [
        { command: "node e2e/smtp-sink.mjs", port: 2526, reuseExistingServer: false },
        {
          command: `pnpm exec next start -p ${PORT}`,
          url: `http://localhost:${PORT}/api/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          env: {
            DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
            BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
            BETTER_AUTH_URL: `http://localhost:${PORT}`,
            SMTP_URL: "smtp://127.0.0.1:2525",
            MAIL_FROM: "CONSYRIUM AI <no-reply@e2e.test>",
            // Only for the local test mail server's self-signed certificate (STARTTLS is required by the app).
            NODE_TLS_REJECT_UNAUTHORIZED: "0",
          },
        },
      ],
});
